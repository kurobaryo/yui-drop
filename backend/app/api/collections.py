"""Collection (shared-room) endpoints — rooms, messages, admin verify/ops.

This module defines the FastAPI router for the v0.3.0 Collection feature.
File-upload and SSE endpoints are appended onto the same ``router`` by
parallel modules so the OpenAPI tag stays coherent.

All handlers follow the envelope pattern (``ok({...})``) and convert any
``ServiceError`` raised by the service layer into an HTTPException with the
``{code, message, detail}`` body. Admin actions also write an
``access_logs`` row via ``record_access`` before committing.
"""

from __future__ import annotations

import shutil
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.logging import get_logger
from ..core.rate_limit import real_client_ip
from ..core.security import decode_jwt
from ..db.session import SessionLocal, get_db
from ..models.access_log import AccessLogAction
from ..models.collection_file import CollectionFile
from ..schemas import ok
from ..schemas.collection import (
    AdminToggleUploadRequest,
    CreateCollectionRequest,
    JoinRequest,
    SendMessageRequest,
)
from ..services import collection_sse
from ..services import collections as svc
from ..services import share as svc_share
from ..services.common import ServiceError, record_access

import jwt

router = APIRouter(prefix="/api/collections", tags=["collections"])
log = get_logger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


async def require_member(
    request: Request,
    db: AsyncSession,
    code: str,
    x_member_token: str | None,
):
    """Resolve ``(collection, member)`` from the ``X-Member-Token`` header.

    Returns 401 when the header is missing or the token does not map to an
    active member of the given ``code``. The service layer also rejects
    members whose room has been closed or whose token has been revoked.
    """
    if not x_member_token:
        raise HTTPException(
            status_code=401,
            detail={"code": 4011, "message": "member_token_required"},
        )
    try:
        return await svc.get_member_by_token(db, code=code, member_token=x_member_token)
    except ServiceError as e:
        raise _service_to_http(e) from e


async def require_admin_password_match(
    db: AsyncSession,
    collection: Any,
    x_admin_password: str | None,
) -> bool:
    """Return True when ``X-Admin-Password`` matches the room's admin hash."""
    if not x_admin_password:
        return False
    try:
        return await svc.verify_admin_password(db, collection=collection, admin_password=x_admin_password)
    except ServiceError:
        return False


# ────────────────────────────────────────────────────────────────────────────
# POST /api/collections — create a new room
# ────────────────────────────────────────────────────────────────────────────


@router.post("")
async def create(
    request: Request,
    body: CreateCollectionRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    ip = real_client_ip(request)
    ua = _ua(request)
    try:
        collection, member, member_token = await svc.create_collection(
            db,
            name=body.name,
            visibility=body.visibility,
            entry_password=body.entry_password,
            admin_password=body.admin_password,
            lifetime_days=body.lifetime_days,
            permanent=body.permanent,
            creator_nickname=body.creator_nickname,
            created_by_ip=ip,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await db.commit()
    _ = ua  # reserved for future audit
    return ok(
        {
            "code": collection.code,
            "name": collection.name,
            "visibility": collection.visibility,
            "upload_enabled": collection.upload_enabled,
            "expires_at": collection.expires_at.isoformat()
            if collection.expires_at
            else None,
            "has_entry_password": collection.entry_password_hash is not None,
            "member_token": member_token,
            "member_id": member.id if member else None,
        }
    )


# ────────────────────────────────────────────────────────────────────────────
# GET /api/collections/{code}/preview — public-safe metadata
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{code}/preview")
async def preview(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await svc.preview_collection(db, code=code)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/collections/{code}/join — issue a member token
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{code}/join")
async def join(
    request: Request,
    code: str,
    body: JoinRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    ip = real_client_ip(request)
    ua = _ua(request)
    try:
        member, member_token = await svc.join_collection(
            db,
            code=code,
            nickname=body.nickname,
            entry_password=body.entry_password,
            ip_raw=ip,
        )
        # Fetch collection for response envelope
        collection = await svc.get_collection_by_code(db, code)
    except ServiceError as e:
        raise _service_to_http(e) from e
    await db.commit()
    _ = ua
    return ok(
        {
            "member_token": member_token,
            "member_id": member.id,
            "visibility": collection.visibility,
            "upload_enabled": collection.upload_enabled,
            "nickname": member.nickname,
            "is_creator": member.is_creator,
        }
    )


# ────────────────────────────────────────────────────────────────────────────
# GET /api/collections/{code}/messages — list chat history
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{code}/messages")
async def messages_list(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
    after_id: int | None = None,
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    try:
        out = await svc.list_messages(db, collection=collection, member=member, after_id=after_id)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok({"messages": out})


# ────────────────────────────────────────────────────────────────────────────
# POST /api/collections/{code}/messages — send a chat message
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{code}/messages")
async def messages_send(
    request: Request,
    code: str,
    body: SendMessageRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    try:
        msg = await svc.send_message(
            db,
            collection=collection,
            member=member,
            text=body.text,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await db.commit()
    return ok(
        {
            "message": {
                "id": msg.id,
                "member_id": msg.member_id,
                "nickname": member.nickname,
                "body": msg.body,
                "created_at": (svc.as_utc(msg.created_at).isoformat() if msg.created_at else None),
            }
        }
    )


# ────────────────────────────────────────────────────────────────────────────
# DELETE /api/collections/{code}/messages/{message_id}
# Allowed for: the message author OR the room admin (X-Admin-Password match).
# ────────────────────────────────────────────────────────────────────────────


@router.delete("/{code}/messages/{message_id}")
async def messages_delete(
    request: Request,
    code: str,
    message_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
    x_admin_password: str | None = Header(default=None, alias="X-Admin-Password"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    is_admin = await require_admin_password_match(db, collection, x_admin_password)
    try:
        await svc.delete_message(
            db,
            collection=collection,
            member=member,
            message_id=message_id,
            by_admin=is_admin,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await db.commit()
    return ok({"deleted": True})


# ────────────────────────────────────────────────────────────────────────────
# POST /api/collections/{code}/admin/verify
# Verifies the admin password AND flips ``is_creator=True`` on the calling
# member so subsequent member-scoped UI can render the admin panel without a
# second round-trip.
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{code}/admin/verify")
async def admin_verify(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
    x_admin_password: str | None = Header(default=None, alias="X-Admin-Password"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    ip = real_client_ip(request)
    ua = _ua(request)

    if not x_admin_password:
        raise HTTPException(
            status_code=401,
            detail={"code": 4012, "message": "admin_password_required"},
        )

    try:
        verified = await svc.verify_admin_password(db, collection=collection, admin_password=x_admin_password)
    except ServiceError as e:
        raise _service_to_http(e) from e

    if not verified:
        await record_access(
            db,
            action=AccessLogAction.ADMIN_ACTION,
            ip=ip,
            ua=ua,
            status_code=401,
            extra={
                "event": "collection.admin.verify.fail",
                "code": code,
                "member_id": getattr(member, "id", None),
            },
        )
        await db.commit()
        raise HTTPException(
            status_code=401,
            detail={"code": 4013, "message": "invalid_admin_password"},
        )

    try:
        out = await svc.mark_member_creator(db, member)
    except ServiceError as e:
        raise _service_to_http(e) from e

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        status_code=200,
        extra={
            "event": "collection.admin.verify.success",
            "code": code,
            "member_id": getattr(member, "id", None),
        },
    )
    await db.commit()
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/collections/{code}/admin/upload-toggle
# Admin-password-gated (does NOT require a member token — the creator may
# call from a fresh browser that has no member session).
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{code}/admin/upload-toggle")
async def admin_upload_toggle(
    request: Request,
    code: str,
    body: AdminToggleUploadRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_admin_password: str | None = Header(default=None, alias="X-Admin-Password"),
) -> dict[str, Any]:
    ip = real_client_ip(request)
    ua = _ua(request)

    try:
        collection = await svc.get_collection_by_code(db, code=code)
    except ServiceError as e:
        raise _service_to_http(e) from e

    if not await require_admin_password_match(db, collection, x_admin_password):
        await record_access(
            db,
            action=AccessLogAction.ADMIN_ACTION,
            ip=ip,
            ua=ua,
            status_code=401,
            extra={"event": "collection.admin.upload_toggle.deny", "code": code},
        )
        await db.commit()
        raise HTTPException(
            status_code=401,
            detail={"code": 4013, "message": "invalid_admin_password"},
        )

    try:
        out = await svc.admin_toggle_upload(
            db,
            collection=collection,
            enabled=body.enabled,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        status_code=200,
        extra={
            "event": "collection.admin.upload_toggle",
            "code": code,
            "enabled": body.enabled,
        },
    )
    await db.commit()
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/collections/{code}/admin/close
# Closes the room (no more joins / messages / uploads). Soft, reversible at
# the service layer's discretion.
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{code}/admin/close")
async def admin_close(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_admin_password: str | None = Header(default=None, alias="X-Admin-Password"),
) -> dict[str, Any]:
    ip = real_client_ip(request)
    ua = _ua(request)

    try:
        collection = await svc.get_collection_by_code(db, code=code)
    except ServiceError as e:
        raise _service_to_http(e) from e

    if not await require_admin_password_match(db, collection, x_admin_password):
        await record_access(
            db,
            action=AccessLogAction.ADMIN_ACTION,
            ip=ip,
            ua=ua,
            status_code=401,
            extra={"event": "collection.admin.close.deny", "code": code},
        )
        await db.commit()
        raise HTTPException(
            status_code=401,
            detail={"code": 4013, "message": "invalid_admin_password"},
        )

    try:
        out = await svc.admin_close(db, collection=collection,)
    except ServiceError as e:
        raise _service_to_http(e) from e

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        status_code=200,
        extra={"event": "collection.admin.close", "code": code},
    )
    await db.commit()
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# File + SSE endpoints (v0.3.0).
#
# Files use a 3-step upload protocol:
#   1) POST /files/init                  — allocate row + open multipart
#   2a) POST /files/{id}/sign-part/{n}   — s3: get a presigned URL per part
#   2b) POST /files/{id}/parts/{n}       — local: PUT chunk bytes directly
#   3) POST /files/{id}/complete         — finalize + broadcast
# Plus list / download / delete and a GET /stream SSE endpoint.
# ──── File upload + SSE endpoints (appended) ────────────────────────────────
# ────────────────────────────────────────────────────────────────────────────


class _FileInitRequest(BaseModel):
    name: str
    size: int
    content_type: str | None = None
    chunk_size: int | None = None


class _FilePart(BaseModel):
    part_number: int
    etag: str | None = None


class _FileCompleteRequest(BaseModel):
    upload_id: str
    parts: list[_FilePart] | None = None


async def _get_file_or_404(db: AsyncSession, *, collection: Any, file_id: int) -> CollectionFile:
    row = (
        await db.execute(
            select(CollectionFile).where(
                CollectionFile.id == file_id,
                CollectionFile.collection_id == collection.id,
            )
        )
    ).scalar_one_or_none()
    if row is None or row.deleted_at is not None:
        raise HTTPException(
            status_code=404,
            detail={"code": 4041, "message": "file_not_found"},
        )
    return row


@router.post("/{code}/files/init")
async def files_init(
    request: Request,
    code: str,
    body: _FileInitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    try:
        out = await svc.init_collection_file(
            db,
            collection=collection,
            member=member,
            name=body.name,
            size=body.size,
            content_type=body.content_type,
            chunk_size=body.chunk_size,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await db.commit()
    return ok(out)


@router.post("/{code}/files/{file_id}/sign-part/{part_number}")
async def files_sign_part(
    request: Request,
    code: str,
    file_id: int,
    part_number: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
    upload_id: str | None = None,
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    if not upload_id:
        raise HTTPException(
            status_code=400,
            detail={"code": 4001, "message": "upload_id_required"},
        )
    file_row = await _get_file_or_404(db, collection=collection, file_id=file_id)
    try:
        out = await svc.sign_collection_file_part(
            db,
            collection=collection,
            file_row=file_row,
            upload_id=upload_id,
            part_number=part_number,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


@router.post("/{code}/files/{file_id}/parts/{part_number}")
async def files_upload_part_local(
    request: Request,
    code: str,
    file_id: int,
    part_number: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    upload_id: Annotated[str, Form(...)],
    chunk: Annotated[UploadFile, File(...)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    await _get_file_or_404(db, collection=collection, file_id=file_id)

    try:
        from ..storage.factory import get_storage

        storage = get_storage()
        tmp_root = getattr(storage, "tmp_root", None)
        if tmp_root is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": 4002,
                    "message": "local_chunk_upload_not_supported_for_backend",
                },
            )
        tmp_dir = tmp_root / upload_id
        tmp_dir.mkdir(parents=True, exist_ok=True)
        part_path = tmp_dir / f"part_{part_number}"
        with open(part_path, "wb") as out_fp:
            shutil.copyfileobj(chunk.file, out_fp)
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover — surface as 500
        log.exception("local chunk upload failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail={"code": 5001, "message": "chunk_write_failed"},
        ) from e
    return ok({"part_number": part_number, "received": True})


@router.post("/{code}/files/{file_id}/complete")
async def files_complete(
    request: Request,
    code: str,
    file_id: int,
    body: _FileCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    file_row = await _get_file_or_404(db, collection=collection, file_id=file_id)
    parts_payload = [{"part_number": p.part_number, "etag": p.etag} for p in body.parts] if body.parts else []
    try:
        row = await svc.complete_collection_file(
            db,
            collection=collection,
            file_row=file_row,
            upload_id=body.upload_id,
            parts=parts_payload,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await db.commit()
    return ok(
        {
            "id": row.id,
            "name": row.name,
            "size": row.size,
            "content_type": row.content_type,
            "member_id": row.member_id,
        }
    )


@router.get("/{code}/files")
async def files_list(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    try:
        out = await svc.list_files(db, collection=collection, member=member)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok({"files": out})


@router.get("/{code}/files/{file_id}/download")
async def files_download(
    request: Request,
    code: str,
    file_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
    token: str | None = None,
) -> dict[str, Any]:
    # Accept member token from either ``X-Member-Token`` header (preferred)
    # or ``?token=<member_token>`` query (legacy frontend behaviour and a
    # convenience for tools that can't set headers). Both shapes resolve to
    # the same auth.
    effective_token = x_member_token or token
    collection, member = await require_member(request, db, code, effective_token)
    file_row = await _get_file_or_404(db, collection=collection, file_id=file_id)
    try:
        url, expires_in = await svc.get_file_download_url(
            db, collection=collection, file_row=file_row, member=member
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok({"download_url": url, "expires_in": expires_in})


@router.get("/{code}/files/{file_id}/blob")
async def files_blob_stream(
    request: Request,
    code: str,
    file_id: int,
    token: str | None = None,
) -> StreamingResponse:
    """Stream a collection file's bytes for local backend downloads.

    Authentication is by short-lived JWT in the ``?token=`` query string
    issued by :func:`get_file_download_url`. We do NOT require an
    ``X-Member-Token`` header or ``mt_<code>`` cookie here — those don't
    travel reliably on plain ``<a href>`` navigation (Safari mobile drops
    SameSite=Lax cookies on cross-tab opens; users with the dashboard
    open in one PWA tab and downloads opening in Safari proper miss them
    entirely). The JWT is single-purpose: it carries the storage_key,
    wrapped DEK, filename and ids needed to fetch + decrypt the object,
    and it expires in 15 minutes. Anyone who got the URL (the original
    member who clicked download) has authority for this download only.
    """
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"code": 4011, "message": "blob_token_required"},
        )
    try:
        payload = decode_jwt(token)
    except jwt.PyJWTError as e:
        raise HTTPException(
            status_code=401,
            detail={"code": 4012, "message": "blob_token_invalid"},
        ) from e

    storage_key = payload.get("k")
    if not storage_key:
        raise HTTPException(
            status_code=401,
            detail={"code": 4012, "message": "blob_token_malformed"},
        )
    wrapped_dek_hex = payload.get("d")
    wrapped_dek = bytes.fromhex(wrapped_dek_hex) if wrapped_dek_hex else None
    display_name = payload.get("fn") or f"file-{file_id}"

    body, head = await svc_share.open_download_stream(storage_key, wrapped_dek=wrapped_dek)

    # RFC 5987 filename header — same pattern as the share download path
    # so CJK / emoji file names survive the latin-1 header transport.
    from urllib.parse import quote as _q
    ascii_name = display_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    if not ascii_name.strip("_") or ascii_name != display_name:
        ascii_name = f"file-{file_id}"
    ascii_name = ascii_name.replace('"', "").replace("\\", "").replace("\r", "").replace("\n", "")

    headers: dict[str, str] = {
        "content-disposition": (
            f'attachment; filename="{ascii_name}"; '
            f"filename*=UTF-8''{_q(display_name)}"
        ),
        "cache-control": "private, max-age=60",
    }
    if head.get("size") is not None:
        headers["content-length"] = str(head["size"])

    media_type = head.get("content_type") or "application/octet-stream"
    return StreamingResponse(body, media_type=media_type, headers=headers)


@router.delete("/{code}/files/{file_id}")
async def files_delete(
    request: Request,
    code: str,
    file_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_member_token: str | None = Header(default=None, alias="X-Member-Token"),
    x_admin_password: str | None = Header(default=None, alias="X-Admin-Password"),
) -> dict[str, Any]:
    collection, member = await require_member(request, db, code, x_member_token)
    is_admin = await require_admin_password_match(db, collection, x_admin_password)
    file_row = await _get_file_or_404(db, collection=collection, file_id=file_id)
    try:
        await svc.delete_collection_file(
            db,
            collection=collection,
            file_row=file_row,
            by_admin=is_admin,
            member=member,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await db.commit()
    return ok({"deleted": True, "id": file_id})


# ────────────────────────────────────────────────────────────────────────────
# GET /api/collections/{code}/stream — SSE
# EventSource cannot send custom headers, so auth uses ?token=<member_token>.
#
# IMPORTANT: this handler does NOT use ``Depends(get_db)``. FastAPI's
# dependency-injected session would stay open for the lifetime of the SSE
# generator (potentially hours), holding the SQLite write lock the whole
# time and producing ``database is locked`` errors for every other request
# touching the same room.
#
# Instead we acquire a short-lived session, authenticate, commit, and
# release it before entering the long-running event loop. The event loop
# itself is pure in-memory ``asyncio.Queue.get()`` — no DB session, no
# transaction, no locks held. This matches the pattern used by Synapse,
# Mattermost, GoToSocial and other production realtime apps (see
# yui-drop-deploy skill v0.3.5 lesson for the postmortem and references).
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{code}/stream")
async def stream(
    request: Request,
    code: str,
    token: str | None = None,
) -> StreamingResponse:
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"code": 4011, "message": "member_token_required"},
        )

    # Short-lived session for auth only. Commit explicitly so any
    # presence/last_seen-related writes inside ``get_member_by_token`` flush
    # immediately and release SQLite's writer slot. ``async with`` then
    # closes the session before we enter the long-running event loop.
    async with SessionLocal() as auth_session:
        try:
            collection, member = await svc.get_member_by_token(
                auth_session, code=code, member_token=token
            )
        except ServiceError as e:
            raise _service_to_http(e) from e
        await auth_session.commit()
        # Snapshot the few fields we need for filtering — accessing
        # ORM-loaded attributes after session close would lazy-load and
        # raise ``DetachedInstanceError``.
        collection_id = collection.id
        member_id = member.id
        is_creator = bool(getattr(member, "is_creator", False))

    handle = await collection_sse.subscribe(
        collection_id,
        member_id=member_id,
        is_creator=is_creator,
    )

    async def gen():
        try:
            async for chunk in collection_sse.event_stream(handle):
                yield chunk
        finally:
            await collection_sse.unsubscribe(collection_id, handle)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
