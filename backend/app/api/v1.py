"""Public ``/api/v1`` endpoints — bearer-auth simple + multipart upload + listing.

Endpoints
---------
POST   /api/v1/upload                        — simple upload (≤ simple cap)
POST   /api/v1/upload/init                   — open multipart presigned session
POST   /api/v1/upload/{upload_id}/sign-part  — presigned PUT URL for one part
POST   /api/v1/upload/{upload_id}/complete   — finalize, create share
DELETE /api/v1/upload/{upload_id}            — abort an in-flight session
POST   /api/v1/share/text                    — create a text share
POST   /api/v1/pickup                        — redeem a pickup code (consuming)
GET    /api/v1/shares                        — list shares created by this key
GET    /api/v1/shares/{code}                 — fetch one share by code
DELETE /api/v1/shares/{code}                 — revoke one of this key's shares
POST   /api/v1/share/multi                   — reserve a code for a multi-file share
POST   /api/v1/share/multi/{id}/files        — declare one file
POST   /api/v1/share/multi/{id}/files/{fid}/parts/{n} — upload one part
POST   /api/v1/share/multi/{id}/files/{fid}/complete  — close one file
POST   /api/v1/share/multi/{id}/finalize     — open the share for pickup
DELETE /api/v1/share/multi/{id}              — abort (or revoke once finalized)

All write routes require scope ``upload``; reads require ``read``. Quotas
(``max_file_size`` + ``quota_daily_bytes``) are enforced at the gate; usage
is recorded post-success only.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    Request,
    UploadFile,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.formparsers import MultiPartException, MultiPartParser

from ..core.api_auth import require_api_key
from ..core.config import settings
from ..core.download_token import signed_download_path
from ..core.rate_limit import real_client_ip
from ..db.session import get_db
from ..models.api_key import ApiKey
from ..models.file_code import FileCode
from ..models.multipart_session import MultipartSession
from ..schemas import ok
from ..schemas.v1 import (
    V1MultiCreateRequest,
    V1MultiFileCompleteRequest,
    V1MultiFileRequest,
    V1MultipartCompleteRequest,
    V1MultipartInitRequest,
    V1PickupRequest,
    V1SignPartRequest,
    V1TextShareRequest,
)
from ..services import v1_multi
from ..services.api_quota import check_can_upload, record_usage
from ..services.common import ServiceError, as_utc
from ..services.presign import (
    abort_presign_upload,
    complete_presign_upload,
    init_presign_upload,
    sign_presign_part,
)
from ..services.share import create_simple_file_share, create_text_share, resolve_share
from ..services.v1_shares import revoke_share

router = APIRouter(prefix="/api/v1", tags=["v1"])


def _service_to_http(exc: ServiceError) -> HTTPException:
    """Translate a ``ServiceError`` into our envelope-shaped HTTPException."""
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


def _short_url(code: str) -> str:
    return f"{settings.app_url.rstrip('/')}/s/{code}"


def _signed_url(code: str, share_id: int, file_id: int | None = None) -> str:
    """Absolute download URL carrying a fresh signed token.

    Handed to the owner (upload responses, list/detail) so they can fetch or
    preview their own share without spending a pickup — and so the URL works
    for count-limited shares, which refuse unsigned downloads.
    """
    return f"{settings.app_url.rstrip('/')}{signed_download_path(code, share_id, file_id)}"


async def _share_urls(db: AsyncSession, code: str) -> tuple[str, str]:
    """Return ``(signed_download_url, short_url)`` for a just-created share."""
    share_id = (
        await db.execute(select(FileCode.id).where(FileCode.code == code))
    ).scalar_one()
    return _signed_url(code, share_id), _short_url(code)


# ── Simple upload ───────────────────────────────────────────────────────────


@router.post("/upload")
async def v1_upload(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    file: Annotated[UploadFile, File(...)],
    expire_value: Annotated[int, Form()] = 1,
    expire_style: Annotated[str, Form()] = "day",
):
    """Single-shot upload (≤ admin-configured simple-upload cap)."""
    # Determine size from the spooled UploadFile without loading bytes yet.
    pos = file.file.tell()
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(pos)

    try:
        await check_can_upload(db, api_key, file_size=size)
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    try:
        out = await create_simple_file_share(
            db,
            file_name=file.filename or "file",
            file_obj=file.file,
            file_size=size,
            content_type=file.content_type,
            expire_value=expire_value,
            expire_style=expire_style,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
            created_by_key_id=api_key.id,
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    # Best-effort accounting — never fails the request.
    await record_usage(db, api_key, bytes_used=int(out.get("size") or size))

    url, short_url = await _share_urls(db, out["code"])
    out["url"] = url
    out["short_url"] = short_url
    return ok(out)


# ── Multipart presigned upload ──────────────────────────────────────────────


@router.post("/upload/init")
async def v1_upload_init(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    body: V1MultipartInitRequest,
):
    """Open a multipart-presigned upload session for a large file."""
    try:
        await check_can_upload(db, api_key, file_size=body.file_size)
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    try:
        out = await init_presign_upload(
            db,
            file_name=body.file_name,
            file_size=body.file_size,
            content_type=body.content_type,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
            created_by_key_id=api_key.id,
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    # Don't leak the upstream S3 multipart id to /api/v1 callers — our own
    # opaque ``upload_id`` is the only handle they need.
    return ok(
        {
            "upload_id": out["upload_id"],
            "key": out["key"],
            "part_size": out["part_size"],
            "parts_total": out["parts_total"],
            "expires_at": out["expires_at"],
        }
    )


async def _load_owned_session(
    db: AsyncSession, *, upload_id: str, api_key: ApiKey
) -> MultipartSession:
    """Return the multipart session iff it belongs to ``api_key`` — else 404."""
    sess = (
        await db.execute(
            select(MultipartSession).where(
                MultipartSession.upload_id == upload_id,
                MultipartSession.created_by_key_id == api_key.id,
            )
        )
    ).scalars().first()
    if sess is None:
        # Same envelope as any other "not yours / doesn't exist" — no leak.
        raise HTTPException(
            status_code=404,
            detail={"code": 4040, "message": "upload_not_found", "detail": None},
        )
    return sess


@router.post("/upload/{upload_id}/sign-part")
async def v1_upload_sign_part(
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    body: V1SignPartRequest,
    upload_id: Annotated[str, Path(min_length=1)],
):
    """Return a presigned PUT URL for one part of an open multipart upload."""
    await _load_owned_session(db, upload_id=upload_id, api_key=api_key)
    try:
        out = await sign_presign_part(
            db, upload_id=upload_id, part_number=body.part_number,
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(out)


@router.post("/upload/{upload_id}/complete")
async def v1_upload_complete(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    body: V1MultipartCompleteRequest,
    upload_id: Annotated[str, Path(min_length=1)],
):
    """Finalize a multipart upload and create the share row."""
    await _load_owned_session(db, upload_id=upload_id, api_key=api_key)
    parts = [
        {"part_number": p.part_number, "etag": p.etag} for p in body.parts
    ]
    try:
        out = await complete_presign_upload(
            db,
            upload_id=upload_id,
            parts=parts,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    real_size = int(out.get("size") or 0)
    if real_size > 0:
        await record_usage(db, api_key, bytes_used=real_size)

    url, short_url = await _share_urls(db, out["code"])
    payload = {
        "code": out["code"],
        "name": out.get("name"),
        "size": real_size,
        "expired_at": out["expired_at"],
        "expired_count": out["expired_count"],
        "url": url,
        "short_url": short_url,
    }
    return ok(payload)


@router.delete("/upload/{upload_id}")
async def v1_upload_abort(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    upload_id: Annotated[str, Path(min_length=1)],
):
    """Abort an in-flight multipart upload owned by this key."""
    await _load_owned_session(db, upload_id=upload_id, api_key=api_key)
    try:
        out = await abort_presign_upload(
            db,
            upload_id=upload_id,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(out)


# ── Text share ──────────────────────────────────────────────────────────────


@router.post("/share/text")
async def v1_share_text(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    body: V1TextShareRequest,
):
    """Create a text-only share owned by this API key.

    Unlike the anonymous ``POST /api/share/text`` used by the SPA, the row is
    stamped with ``created_by_key_id`` so it appears in ``GET /api/v1/shares``.
    Text bodies are capped by ``settings.max_text_bytes`` inside the service.
    """
    size = len(body.text.encode("utf-8"))
    try:
        await check_can_upload(db, api_key, file_size=size)
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    try:
        out = await create_text_share(
            db,
            text=body.text,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
            created_by_key_id=api_key.id,
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    await record_usage(db, api_key, bytes_used=size)

    # Text shares have no download URL — the body rides in the pickup payload.
    out["size"] = size
    out["url"] = None
    out["short_url"] = _short_url(out["code"])
    return ok(out)


# ── Multi-file share ────────────────────────────────────────────────────────

_ID = r"^[A-Za-z0-9_-]+$"
ShareIdPath = Annotated[str, Path(pattern=_ID, max_length=64)]
FileIdPath = Annotated[str, Path(pattern=_ID, max_length=64)]


class _InMemoryPartParser(MultiPartParser):
    """multipart/form-data parser that keeps the uploaded part in memory.

    Starlette spools file fields over 1 MiB to a temp file; parts here are
    up to ``PART_SIZE`` and go straight on to the object store, so they are
    kept in RAM and capped instead.
    """

    spool_max_size = v1_multi.PART_SIZE + 1024 * 1024

    def __init__(self, headers, stream, *, max_file_bytes: int) -> None:
        super().__init__(headers, stream, max_files=1, max_fields=8)
        self._max_file_bytes = max_file_bytes
        self._file_bytes = 0

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        if self._current_part.file is not None:
            self._file_bytes += end - start
            if self._file_bytes > self._max_file_bytes:
                raise MultiPartException("part too large")
        super().on_part_data(data, start, end)


async def _read_chunk_field(request: Request) -> bytes:
    """Bytes of the ``chunk`` file field of a multipart/form-data body."""
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise _service_to_http(
            ServiceError("chunk_required", code=4002, http_status=400)
        )
    parser = _InMemoryPartParser(
        request.headers, request.stream(), max_file_bytes=v1_multi.PART_SIZE
    )
    try:
        form = await parser.parse()
    except MultiPartException as exc:
        raise _service_to_http(
            ServiceError(
                "invalid_part_size", code=4002, http_status=400,
                detail={"max_bytes": v1_multi.PART_SIZE, "reason": str(exc)},
            )
        ) from exc
    chunk = form.get("chunk")
    if chunk is None or isinstance(chunk, str):
        raise _service_to_http(
            ServiceError("chunk_required", code=4002, http_status=400)
        )
    try:
        return await chunk.read()
    finally:
        await chunk.close()


@router.post("/share/multi")
async def v1_multi_create(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    body: V1MultiCreateRequest,
):
    """Reserve a pickup code for a multi-file share (optionally with a note).

    The code can't be picked up until ``finalize``.
    """
    try:
        out = await v1_multi.create_multi(
            db,
            api_key=api_key,
            declared_file_count=body.declared_file_count,
            declared_total_size=body.declared_total_size,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            text=body.text,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(out)


@router.post("/share/multi/{share_id}/files")
async def v1_multi_add_file(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    share_id: ShareIdPath,
    body: V1MultiFileRequest,
):
    """Declare one file; returns its id and the part plan."""
    try:
        out = await v1_multi.register_file(
            db,
            api_key=api_key,
            share_id=share_id,
            name=body.name,
            size=body.size,
            content_type=body.content_type,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(out)


@router.post("/share/multi/{share_id}/files/{file_id}/parts/{part_number}")
async def v1_multi_upload_part(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    share_id: ShareIdPath,
    file_id: FileIdPath,
    part_number: Annotated[int, Path(ge=1, le=10000)],
):
    """Upload part ``n`` (1-based) as multipart field ``chunk``.

    Every part but the last must be exactly ``part_size`` bytes. Ownership
    and the part number are checked before the body is read.
    """
    try:
        share, sf = await v1_multi.check_part_target(
            db, api_key=api_key, share_id=share_id, file_id=file_id,
            part_number=part_number,
        )
        # End the read transaction before receiving up to PART_SIZE from a
        # possibly slow client.
        await db.commit()
        data = await _read_chunk_field(request)
        out = await v1_multi.upload_part(
            db, share=share, sf=sf, part_number=part_number, data=data
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(out)


@router.post("/share/multi/{share_id}/files/{file_id}/complete")
async def v1_multi_complete_file(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    share_id: ShareIdPath,
    file_id: FileIdPath,
    body: V1MultiFileCompleteRequest,
):
    """Close one file once all its parts are uploaded."""
    try:
        out = await v1_multi.complete_file(
            db,
            api_key=api_key,
            share_id=share_id,
            file_id=file_id,
            parts=[p.model_dump() for p in body.parts],
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    if out.pop("newly_completed"):
        # Per-file accounting, like any other upload by this key.
        await record_usage(db, api_key, bytes_used=int(out["size"]))
    return ok(out)


@router.post("/share/multi/{share_id}/finalize")
async def v1_multi_finalize(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    share_id: ShareIdPath,
):
    """Open the share for pickup. Idempotent.

    Returns the same entry as ``GET /api/v1/shares/{code}``. The share's
    expiry is counted from this moment.
    """
    try:
        row = await v1_multi.finalize(
            db,
            api_key=api_key,
            share_id=share_id,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(_row_to_list_item(row))


@router.delete("/share/multi/{share_id}")
async def v1_multi_abort(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    share_id: ShareIdPath,
):
    """Abort the upload: release the code and delete whatever was stored.

    On an already-finalized share this revokes it instead (same as
    ``DELETE /api/v1/shares/{code}``) and still answers ``aborted: true``.
    """
    try:
        out = await v1_multi.abort(
            db,
            api_key=api_key,
            share_id=share_id,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(out)


# ── Pickup ──────────────────────────────────────────────────────────────────


@router.post("/pickup")
async def v1_pickup(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("read"))],
    body: V1PickupRequest,
):
    """Redeem a pickup code — any code, not just ones this key created.

    Consuming operation: decrements ``expired_count`` and bumps ``used_count``,
    identical to the SPA pickup path.

    Failure tracking is keyed on the API key rather than the caller IP. v1
    clients typically sit behind a server-side proxy, so every request would
    otherwise share one source IP and a single client mistyping codes could
    ban the entire upstream host for everyone. The real IP is still recorded
    in the access log.
    """
    try:
        out = await resolve_share(
            db,
            code=body.code,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
            fail_key=f"key:{api_key.id}",
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    # resolve_share hands back same-origin relative paths; v1 clients are
    # off-host, so promote them to absolute URLs.
    base = settings.app_url.rstrip("/")

    def _abs(value: str | None) -> str | None:
        return f"{base}{value}" if value and value.startswith("/") else value

    out["url"] = _abs(out.get("url"))
    for member in out.get("files") or []:
        member["url"] = _abs(member.get("url"))
    return ok(out)


# ── Share listing ───────────────────────────────────────────────────────────


def _iso(dt: datetime | None) -> str | None:
    """UTC ISO-8601 with offset (SQLite hands datetimes back naive)."""
    return as_utc(dt).isoformat() if dt is not None else None


def _row_to_list_item(row: FileCode) -> dict:
    """Project a ``FileCode`` row to the v1 list/detail wire shape."""
    # Only single-file shares get a URL: a text body rides in the pickup
    # payload, and a multi share has one URL per member file. The URL is
    # minted per request with a short-lived token, so the owner can preview
    # without spending a pickup.
    is_file = row.kind != "multi" and not row.is_text_share
    item = {
        "code": row.code,
        "name": row.name,
        "size": row.size,
        "kind": row.kind,
        "expired_at": _iso(row.expired_at),
        "expired_count": row.expired_count,
        "used_count": row.used_count,
        "created_at": _iso(row.created_at) or "",
        "url": _signed_url(row.code, row.id) if is_file else None,
        "short_url": _short_url(row.code),
    }
    if row.kind == "multi":
        item["name"] = None
        item["size"] = None
        item["file_count"] = row.file_count
        item["total_size"] = row.total_size or 0
        item["has_note"] = row.text is not None
    return item


@router.get("/shares")
async def v1_list_shares(
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("read"))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    status: Annotated[Literal["active", "expired", "all"], Query()] = "active",
):
    """List shares created by this API key.

    ``status`` ∈ {``active``, ``all``, ``expired``}.

    * ``active`` (default) — not soft-deleted AND (no time expiry OR not yet
      past it) AND (no count expiry OR count != 0).
    * ``expired`` — not soft-deleted AND past time-expiry OR count == 0.
    * ``all`` — everything not soft-deleted (live + expired).
    """
    base_filter = [
        FileCode.created_by_key_id == api_key.id,
        FileCode.deleted_at.is_(None),
        # A multi share still being uploaded isn't a share yet.
        FileCode.finalized.is_(True),
    ]
    now = datetime.now(UTC)
    if status == "active":
        # not time-expired AND not count-expired
        q_filter = base_filter + [
            (FileCode.expired_at.is_(None)) | (FileCode.expired_at > now),
            FileCode.expired_count != 0,
        ]
    elif status == "expired":
        q_filter = base_filter + [
            (
                (FileCode.expired_at.is_not(None)) & (FileCode.expired_at <= now)
            )
            | (FileCode.expired_count == 0),
        ]
    else:  # "all" or any unknown value falls back to "all"
        q_filter = base_filter

    total = int(
        (
            await db.execute(
                select(func.count()).select_from(FileCode).where(*q_filter)
            )
        ).scalar_one()
    )
    rows = (
        await db.execute(
            select(FileCode)
            .where(*q_filter)
            .order_by(FileCode.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()

    return ok(
        {
            "total": total,
            "items": [_row_to_list_item(r) for r in rows],
        }
    )


@router.get("/shares/{code}")
async def v1_get_share(
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("read"))],
    code: Annotated[str, Path(min_length=1, max_length=16)],
):
    """Fetch a single share by code — only if owned by this API key."""
    row = (
        await db.execute(
            select(FileCode).where(
                FileCode.code == code,
                FileCode.created_by_key_id == api_key.id,
                FileCode.deleted_at.is_(None),
                FileCode.finalized.is_(True),
            )
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"code": 4040, "message": "share_not_found", "detail": None},
        )
    return ok(_row_to_list_item(row))


@router.delete("/shares/{code}")
async def v1_revoke_share(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    api_key: Annotated[ApiKey, Depends(require_api_key("upload"))],
    code: Annotated[str, Path(min_length=1, max_length=16)],
):
    """Revoke a share this key created.

    Soft delete: pickup and every download URL answer 404 immediately. Another
    key's share, an unknown code and an already-deleted share all answer 404
    ``share_not_found`` — never 403, so the route can't confirm a code exists.
    """
    try:
        out = await revoke_share(
            db,
            code=code,
            api_key_id=api_key.id,
            ip=real_client_ip(request),
            ua=request.headers.get("user-agent"),
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc
    return ok(out)
