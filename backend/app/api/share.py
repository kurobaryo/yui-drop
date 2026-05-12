"""Share endpoints: text + simple file + select + download."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.rate_limit import limiter, real_client_ip, upload_limit
from ..db.session import get_db
from ..models.access_log import AccessLogAction
from ..schemas import ok
from ..schemas.share import (
    ShareSelectRequest,
    ShareTextRequest,
)
from ..services.common import ServiceError, record_access
from ..services.share import (
    authorize_download_token,
    create_simple_file_share,
    create_text_share,
    open_download_stream,
    resolve_download_target,
    resolve_share,
)

router = APIRouter(prefix="/api/share", tags=["share"])


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    """Translate a ServiceError into an HTTPException with our envelope shape."""
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


# ────────────────────────────────────────────────────────────────────────────
# POST /api/share/text
# ────────────────────────────────────────────────────────────────────────────


@router.post("/text")
@limiter.limit(upload_limit())
async def share_text(
    request: Request,
    response: Response,
    body: ShareTextRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Create a text share. Rate-limited per IP."""
    ip = real_client_ip(request)
    try:
        out = await create_text_share(
            db,
            text=body.text,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            ip=ip,
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/share/file  (multipart/form-data, ≤ 10 MiB)
# ────────────────────────────────────────────────────────────────────────────


@router.post("/file")
@limiter.limit(upload_limit())
async def share_file(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: Annotated[UploadFile, File(...)],
    expire_value: Annotated[int, Form()] = 1,
    expire_style: Annotated[str, Form()] = "day",
) -> dict[str, Any]:
    ip = real_client_ip(request)
    size = 0
    # Drain the SpooledTemporaryFile so we know the actual size.
    pos = file.file.tell()
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(pos)
    try:
        out = await create_simple_file_share(
            db,
            file_name=file.filename or "file",
            file_obj=file.file,
            file_size=size,
            content_type=file.content_type,
            expire_value=expire_value,
            expire_style=expire_style,
            ip=ip,
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/share/select
# ────────────────────────────────────────────────────────────────────────────


@router.post("/select")
async def share_select(
    request: Request,
    body: ShareSelectRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    ip = real_client_ip(request)
    try:
        out = await resolve_share(db, code=body.code, ip=ip, ua=_ua(request))
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/share/download  (local-backend token-protected proxy)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/download")
async def share_download(
    request: Request,
    token: Annotated[str, Query(...)],
    filename: Annotated[str | None, Query()] = None,
) -> StreamingResponse:
    """Stream an object referenced by a short-lived signed token.

    Only used when the storage backend cannot mint native presigned URLs
    (local FS today; OneDrive/WebDAV when implemented).
    """
    try:
        key, fn_from_token = await authorize_download_token(token)
        body, head = await open_download_stream(key)
    except ServiceError as e:
        raise _service_to_http(e) from e

    display_name = filename or fn_from_token or key.rsplit("/", 1)[-1]
    headers: dict[str, str] = {}
    if head.get("size") is not None:
        headers["content-length"] = str(head["size"])
    # Always attachment for the local-backed download path — keeps inert in browsers.
    from urllib.parse import quote as _q

    headers["content-disposition"] = (
        f'attachment; filename="{display_name}"; filename*=UTF-8\'\'{_q(display_name)}'
    )
    return StreamingResponse(body, media_type="application/octet-stream", headers=headers)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/share/download/{code}            — single-file share proxy
# GET /api/share/download/{code}/{file_id}  — multi-file share, one file
# ────────────────────────────────────────────────────────────────────────────


async def _stream_share_payload(
    request: Request,
    db: AsyncSession,
    code: str,
    file_id: int | None,
) -> StreamingResponse:
    """Shared body for the two same-origin download routes.

    Resolves the share, opens a server-side stream from the storage
    backend (boto3 ``get_object`` body for S3, async file iterator for
    local FS), and writes an access_logs row. The audit toggle is
    honoured inside :func:`record_access`, so callers don't need to
    re-check it here.
    """
    try:
        target = await resolve_download_target(db, code=code, file_id=file_id)
        body, head = await open_download_stream(target["key"])
    except ServiceError as e:
        raise _service_to_http(e) from e

    # Resolve a sensible content-type. Prefer the storage HEAD answer
    # (S3 stores the upload-time content-type as object metadata) and
    # fall back to the suffix-based guess we computed at resolve time.
    ct: str = head.get("content_type") or target["content_type"]

    # Some MIME types (svg, html, xml) become XSS vectors when rendered
    # inline by browsers. For those we replay the FORCE_DOWNLOAD list and
    # hand the bytes back as a generic attachment.
    force_dl: bool = bool(target["force_download"])
    display_name: str = target["name"] or code
    media_type = "application/octet-stream" if force_dl else ct

    from urllib.parse import quote as _q

    disposition = "attachment" if force_dl else "inline"
    headers: dict[str, str] = {
        "content-disposition": (
            f'{disposition}; filename="{display_name}"; '
            f"filename*=UTF-8''{_q(display_name)}"
        ),
        # Same-origin proxy bytes are inherently cacheable per-code; let
        # the browser hold onto them briefly so repeat <img> renders
        # don't hammer R2. Short TTL keeps the cache from outliving a
        # code's expiry by much.
        "cache-control": "private, max-age=60",
    }
    if head.get("size") is not None:
        headers["content-length"] = str(head["size"])

    # Append the audit row. record_access honours the audit.log_access_ip
    # toggle (default on) — when off, the IP is dropped before insert.
    ip = real_client_ip(request)
    await record_access(
        db,
        action=AccessLogAction.SHARE_RETRIEVE,
        code=code,
        ip=ip,
        ua=_ua(request),
        status_code=200,
        extra={
            "event": "share.download.proxy",
            "file_id": file_id,
            "size": head.get("size"),
            "force_download": force_dl,
        },
    )
    await db.commit()

    return StreamingResponse(body, media_type=media_type, headers=headers)


@router.get("/download/{code}")
async def share_download_by_code(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Same-origin proxy for single-file shares.

    Streams the underlying object through this process so the browser
    never sees an R2 presigned URL. Restores ``<img>`` previews that
    were blocked by cross-origin CORS and centralises access logging.
    """
    return await _stream_share_payload(request, db, code, None)


@router.get("/download/{code}/{file_id}")
async def share_download_multi_by_code(
    request: Request,
    code: str,
    file_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    """Same-origin proxy for one file inside a multi-file share."""
    return await _stream_share_payload(request, db, code, file_id)
