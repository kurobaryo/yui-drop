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

from ..core.api_auth import require_api_key
from ..core.config import settings
from ..core.rate_limit import real_client_ip
from ..db.session import get_db
from ..models.api_key import ApiKey
from ..models.file_code import FileCode
from ..models.multipart_session import MultipartSession
from ..schemas import ok
from ..schemas.v1 import (
    V1MultipartCompleteRequest,
    V1MultipartInitRequest,
    V1PickupRequest,
    V1SignPartRequest,
    V1TextShareRequest,
)
from ..services.api_quota import check_can_upload, record_usage
from ..services.common import ServiceError
from ..services.presign import (
    abort_presign_upload,
    complete_presign_upload,
    init_presign_upload,
    sign_presign_part,
)
from ..services.share import create_simple_file_share, create_text_share, resolve_share

router = APIRouter(prefix="/api/v1", tags=["v1"])


def _service_to_http(exc: ServiceError) -> HTTPException:
    """Translate a ``ServiceError`` into our envelope-shaped HTTPException."""
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


def _share_urls(code: str) -> tuple[str, str]:
    """Return ``(download_url, short_url)`` for a pickup code."""
    base = settings.app_url.rstrip("/")
    return f"{base}/api/share/download/{code}", f"{base}/s/{code}"


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

    url, short_url = _share_urls(out["code"])
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

    url, short_url = _share_urls(out["code"])
    # The presign service returns code/name/size only — flesh out the envelope
    # to match the v1 contract.
    payload = {
        "code": out["code"],
        "name": out.get("name"),
        "size": real_size,
        "expired_at": out.get("expired_at"),
        "expired_count": out.get("expired_count", -1),
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
    _, short_url = _share_urls(out["code"])
    out["size"] = size
    out["url"] = None
    out["short_url"] = short_url
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


def _row_to_list_item(row: FileCode) -> dict:
    """Project a ``FileCode`` row to the v1 list/detail wire shape."""
    base = settings.app_url.rstrip("/")
    # Text shares don't get a download URL (the body is in the resolve payload).
    is_text = row.text is not None and row.file_path is None
    url = None if is_text else f"{base}/api/share/download/{row.code}"
    return {
        "code": row.code,
        "name": row.name,
        "size": row.size,
        "kind": row.kind,
        "expired_at": row.expired_at.isoformat() if row.expired_at else None,
        "expired_count": row.expired_count,
        "used_count": row.used_count,
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "url": url,
        "short_url": f"{base}/s/{row.code}",
    }


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
            )
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"code": 4040, "message": "share_not_found", "detail": None},
        )
    return ok(_row_to_list_item(row))
