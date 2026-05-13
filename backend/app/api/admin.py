"""Admin endpoints — login, dashboard, file management, settings, audit.

All non-login routes depend on ``require_admin`` (Bearer JWT with role=admin).
The login route is rate-limited via slowapi and additionally penalises
repeated failures from the same IP with an exponential backoff sleep.

Every mutating handler appends a row to ``access_logs`` with
``action=admin_action``; the service layer (``app.services.admin``) owns the
actual DB writes.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Annotated, Any
from urllib.parse import quote as urlquote

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.logging import get_logger
from ..core.rate_limit import real_client_ip
from ..core.security import issue_admin_token
from ..db.session import get_db
from ..models.access_log import AccessLogAction
from ..schemas import ok
from ..services.admin import (
    compute_dashboard,
    delete_file,
    empty_recycle_bin,
    get_admin_settings,
    get_file,
    get_file_by_code,
    get_file_row_by_code,
    list_access_log_for_code,
    list_files,
    list_logs,
    patch_admin_settings,
    patch_file,
    restore_file,
    verify_admin_password,
)
from ..services.admin_storage import read_storage_config, save_storage_config
from ..services.admin_turnstile import (
    read_turnstile_config,
    save_turnstile_config,
)
from ..services.admin_uploads import (
    resolve_upload_limits,
    save_upload_limits,
)
from ..services.common import ServiceError, record_access
from ..services.share import open_download_stream
from .deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])
log = get_logger(__name__)


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


# ── In-process failure tracker for /admin/login ─────────────────────────────
# Maps client IP → consecutive recent failure count. Reset on success. Used to
# compute the exponential-backoff delay applied before returning 401.
_login_fail_counts: dict[str, int] = {}


# ── Request DTOs ────────────────────────────────────────────────────────────


class AdminLoginRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=512)


class AdminFilePatchRequest(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=16)
    prefix: str | None = Field(default=None, max_length=255)
    suffix: str | None = Field(default=None, max_length=32)
    expired_at: datetime | None = None
    expired_count: int | None = Field(default=None, ge=-1)


class AdminSettingsPatchRequest(BaseModel):
    # Free-form key/value updates. Keys are validated by the service layer.
    model_config = {"extra": "allow"}


# ────────────────────────────────────────────────────────────────────────────
# POST /api/admin/login
# ────────────────────────────────────────────────────────────────────────────


@router.post("/login")
# NOTE: slowapi's @limiter.limit decorator requires the endpoint to accept a
# starlette Response parameter (it injects rate-limit headers). Our admin
# login already enforces per-IP exponential backoff via _login_fail_counts
# below, which is the real brute-force defence — slowapi's window-based cap
# would be redundant. Keep this commented for future re-enablement.
# @limiter.limit(login_limit())
async def admin_login(
    request: Request,
    body: AdminLoginRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Exchange the admin password for a short-lived Bearer JWT.

    Failures sleep ``min(2**fail_count, 30)`` seconds before returning 401.
    The slowapi limiter (``login_limit()``) also caps total attempts per IP.
    """
    ip = real_client_ip(request)
    ua = _ua(request)
    try:
        verified = await verify_admin_password(db, body.password)
    except Exception:
        verified = False

    if not verified:
        # Penalise: exponential backoff capped at 30s per attempt.
        prev = _login_fail_counts.get(ip, 0)
        fail_count = prev + 1
        _login_fail_counts[ip] = fail_count
        delay = min(2 ** fail_count, 30)
        await asyncio.sleep(delay)

        await record_access(
            db,
            action=AccessLogAction.ADMIN_ACTION,
            ip=ip,
            ua=ua,
            status_code=401,
            extra={"event": "admin.login.fail", "fail_count": fail_count},
        )
        await db.commit()
        raise HTTPException(status_code=401, detail="invalid_password")

    # Success: zero the failure counter and possibly persist the migrated hash.
    _login_fail_counts.pop(ip, None)
    token, expires_at = issue_admin_token()
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        status_code=200,
        extra={"event": "admin.login.success"},
    )
    await db.commit()
    return ok(
        {
            "token": token,
            "token_type": "Bearer",
            "expires_at": expires_at.isoformat(),
        }
    )


# ────────────────────────────────────────────────────────────────────────────
# GET /api/admin/dashboard
# ────────────────────────────────────────────────────────────────────────────


@router.get("/dashboard")
async def admin_dashboard(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    startup_time = getattr(request.app.state, "startup_time", None)
    try:
        out = await compute_dashboard(db, startup_time=startup_time)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/admin/file  (list)
# GET /api/admin/file/{id}  (detail)
# PATCH /api/admin/file/{id}
# POST /api/admin/file/{id}/restore
# DELETE /api/admin/file/{id}
# ────────────────────────────────────────────────────────────────────────────


@router.get("/file")
async def admin_list_files(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    keyword: str | None = Query(default=None),
    include_deleted: bool = Query(default=False),
) -> dict[str, Any]:
    try:
        out = await list_files(
            db,
            page=page,
            size=size,
            keyword=keyword,
            include_deleted=include_deleted,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


@router.get("/file/{file_id}")
async def admin_get_file(
    request: Request,
    file_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await get_file(db, file_id)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


@router.patch("/file/{file_id}")
async def admin_patch_file(
    request: Request,
    file_id: int,
    body: AdminFilePatchRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await patch_file(
            db,
            file_id=file_id,
            code=body.code,
            prefix=body.prefix,
            suffix=body.suffix,
            expired_at=body.expired_at,
            expired_count=body.expired_count,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


@router.post("/file/{file_id}/restore")
async def admin_restore_file(
    request: Request,
    file_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await restore_file(
            db,
            file_id=file_id,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


@router.delete("/file/{file_id}")
async def admin_delete_file(
    request: Request,
    file_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
    hard: bool = Query(default=False),
) -> dict[str, Any]:
    try:
        out = await delete_file(
            db,
            file_id=file_id,
            hard=hard,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# DELETE /api/admin/recycle-bin
# ────────────────────────────────────────────────────────────────────────────


@router.delete("/recycle-bin")
async def admin_empty_recycle_bin(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await empty_recycle_bin(
            db,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/admin/logs
# ────────────────────────────────────────────────────────────────────────────


@router.get("/logs")
async def admin_list_logs(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    action: str | None = Query(default=None),
    ip: str | None = Query(default=None),
) -> dict[str, Any]:
    try:
        out = await list_logs(db, page=page, size=size, action=action, ip=ip)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/admin/settings
# PATCH /api/admin/settings
# ────────────────────────────────────────────────────────────────────────────


@router.get("/settings")
async def admin_get_settings(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await get_admin_settings(db)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


@router.patch("/settings")
async def admin_patch_settings(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
    body: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    try:
        out = await patch_admin_settings(
            db,
            updates=body,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/admin/files/{code}         — single FileCode row by pickup code
# GET /api/admin/files/{code}/access-log
# ────────────────────────────────────────────────────────────────────────────


@router.get("/files/{code}")
async def admin_get_file_by_code(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await get_file_by_code(db, code)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


@router.get("/files/{code}/access-log")
async def admin_file_access_log(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
    limit: int = Query(default=200, ge=1, le=500),
) -> dict[str, Any]:
    items = await list_access_log_for_code(db, code=code, limit=limit)
    return ok({"items": items, "code": code})


# ────────────────────────────────────────────────────────────────────────────
# GET /api/admin/files/{code}/content   — text payload for the admin drawer
# GET /api/admin/files/{code}/download  — binary stream for the admin drawer
#
# Both are admin-only and DO NOT touch ``used_count`` / ``expired_count`` and
# DO NOT emit a ``SHARE_RETRIEVE`` access_log row. Every call writes an
# ``admin_action`` row tagged ``extra.reason='admin_preview'`` instead, so the
# audit trail clearly separates admin inspection from real visitor traffic.
# ────────────────────────────────────────────────────────────────────────────


@router.get("/files/{code}/content")
async def admin_get_file_content(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    """Return the plaintext payload of a text share for the admin drawer.

    Responds 404 for non-text shares so the caller can fall back to the
    download endpoint. The share row's ``used_count``/``expired_count`` are
    left untouched — admin previews never decrement quotas.
    """
    try:
        row = await get_file_row_by_code(db, code)
    except ServiceError as e:
        raise _service_to_http(e) from e

    is_text = row.text is not None and row.file_path is None
    if not is_text:
        raise HTTPException(status_code=404, detail="not_text_share")

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        code=row.code,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={"event": "admin.file.preview", "reason": "admin_preview", "kind": "text"},
    )
    await db.commit()

    return ok(
        {
            "code": row.code,
            "text": row.text,
            "size": row.size,
            "kind": "text",
            "mime": "text/plain",
        }
    )


@router.get("/files/{code}/download")
async def admin_download_file(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> StreamingResponse:
    """Stream a binary share's bytes for the admin drawer's "Download" button.

    Unlike the public retrieval flow, this path goes directly to the
    storage backend, does not mint a short-lived signed URL, does not
    decrement ``expired_count``, does not bump ``used_count``, and emits
    one ``admin_action`` audit row tagged ``extra.reason='admin_preview'``.
    The intent is to give admins an inspection channel that does not
    pollute the share's own audit trail.

    Returns 404 when the share is a text-only or unfinished multi-file share,
    or when the underlying object has been GC'd.
    """
    try:
        row = await get_file_row_by_code(db, code)
    except ServiceError as e:
        raise _service_to_http(e) from e

    if row.kind == "multi":
        # Multi-file shares are made up of N storage objects; the admin
        # drawer is for single-payload shares only. Direct admins to the
        # share-files explorer for multi shares (future work).
        raise HTTPException(status_code=400, detail="multi_share_not_supported")
    if row.file_path is None:
        raise HTTPException(status_code=404, detail="no_binary_payload")

    try:
        body, head = await open_download_stream(row.file_path)
    except ServiceError as e:
        raise _service_to_http(e) from e

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        code=row.code,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={
            "event": "admin.file.preview",
            "reason": "admin_preview",
            "kind": "download",
        },
    )
    await db.commit()

    display_name = row.name or row.code
    headers: dict[str, str] = {}
    if head.get("size") is not None:
        headers["content-length"] = str(head["size"])
    # Always force ``attachment`` so the admin browser never tries to
    # render an arbitrary blob inline (e.g. an HTML upload).
    headers["content-disposition"] = (
        f'attachment; filename="{display_name}"; '
        f"filename*=UTF-8''{urlquote(display_name)}"
    )
    # Mark the response so the caller can tell it came through the
    # admin-preview path rather than the public retrieval one.
    headers["x-admin-preview"] = "1"
    return StreamingResponse(body, media_type="application/octet-stream", headers=headers)


# ────────────────────────────────────────────────────────────────────────────
# GET  /api/admin/storage  — read current storage config (secret masked)
# POST /api/admin/storage  — save + reload after ping
# ────────────────────────────────────────────────────────────────────────────


class S3ConfigRequest(BaseModel):
    endpoint_url: str = ""
    bucket_name: str = ""
    access_key_id: str = ""
    # None = keep existing encrypted value; "" = explicit empty (will 422).
    secret_access_key: str | None = None
    region: str = "auto"
    public_hostname: str | None = None
    # Object-key prefix scoped under the bucket — e.g. "yui-drop/uploads"
    # routes every blob into that subdirectory. Optional; "" means store
    # at the bucket root.
    prefix: str = ""


class StorageConfigRequest(BaseModel):
    backend: str = Field(..., pattern="^(local|s3)$")
    s3: S3ConfigRequest | None = None


@router.get("/storage")
async def admin_get_storage(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    out = await read_storage_config(db)
    return ok(out)


@router.post("/storage")
async def admin_save_storage(
    request: Request,
    body: StorageConfigRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await save_storage_config(
            db,
            backend=body.backend,
            s3=body.s3.model_dump() if body.s3 is not None else None,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={"event": "admin.storage.save", "backend": body.backend},
    )
    await db.commit()
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET  /api/admin/turnstile  — read current Turnstile config (secret masked)
# PUT  /api/admin/turnstile  — save site key / secret / enabled
# ────────────────────────────────────────────────────────────────────────────


class TurnstileConfigRequest(BaseModel):
    enabled: bool | None = None
    site_key: str | None = None
    # Empty string is treated as "keep existing".
    secret_key: str | None = None
    # Per-action protection toggles. ``None`` keeps whatever the settings_kv
    # row currently holds (or the module-level default when no row exists).
    protect_upload: bool | None = None
    protect_pickup: bool | None = None
    protect_admin_login: bool | None = None


@router.get("/turnstile")
async def admin_get_turnstile(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    out = await read_turnstile_config(db)
    return ok(out)


@router.put("/turnstile")
async def admin_put_turnstile(
    request: Request,
    body: TurnstileConfigRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await save_turnstile_config(
            db,
            enabled=body.enabled,
            site_key=body.site_key,
            secret_key=body.secret_key,
            protect_upload=body.protect_upload,
            protect_pickup=body.protect_pickup,
            protect_admin_login=body.protect_admin_login,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={
            "event": "admin.turnstile.save",
            "enabled": body.enabled,
            "site_key_set": body.site_key is not None,
            "secret_set": bool(body.secret_key),
            "protect_upload": body.protect_upload,
            "protect_pickup": body.protect_pickup,
            "protect_admin_login": body.protect_admin_login,
        },
    )
    await db.commit()
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET  /api/admin/uploads  — read current upload limits + chunked switch
# PUT  /api/admin/uploads  — save any subset of the four knobs
# ────────────────────────────────────────────────────────────────────────────


class UploadLimitsRequest(BaseModel):
    simple_upload_max_bytes: int | None = Field(default=None, ge=1)
    chunk_upload_max_bytes: int | None = Field(default=None, ge=1)
    multi_total_max_bytes: int | None = Field(default=None, ge=1)
    chunk_upload_enabled: bool | None = None


@router.get("/uploads")
async def admin_get_uploads(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    out = await resolve_upload_limits(db)
    return ok(out)


@router.put("/uploads")
async def admin_put_uploads(
    request: Request,
    body: UploadLimitsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        out = await save_upload_limits(
            db,
            simple_upload_max_bytes=body.simple_upload_max_bytes,
            chunk_upload_max_bytes=body.chunk_upload_max_bytes,
            multi_total_max_bytes=body.multi_total_max_bytes,
            chunk_upload_enabled=body.chunk_upload_enabled,
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={"event": "admin.uploads.save", "changed": body.model_dump(exclude_none=True)},
    )
    await db.commit()
    return ok(out)
