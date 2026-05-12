"""Share endpoints: text + simple file + select + download."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.rate_limit import limiter, real_client_ip, upload_limit
from ..db.session import get_db
from ..schemas import ok
from ..schemas.share import (
    ShareSelectRequest,
    ShareTextRequest,
)
from ..services.common import ServiceError
from ..services.share import (
    authorize_download_token,
    create_simple_file_share,
    create_text_share,
    open_download_stream,
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
