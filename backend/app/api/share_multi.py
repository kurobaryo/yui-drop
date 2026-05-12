"""Multi-file share API endpoints.

Lifecycle:

    POST /api/share/multi/init                        — start a share
    POST /api/share/multi/{share_id}/file/init        — declare one file
    POST /api/share/multi/{share_id}/file/{file_id}/complete  — close it
    POST /api/share/multi/{share_id}/finalize         — commit the share

Auth: every endpoint except ``init`` requires a Bearer JWT in the
``Authorization`` header, scoped to this share via the token's ``share_id``
claim. The token is returned by ``init`` and expires after 60 min.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.rate_limit import limiter, real_client_ip, upload_limit
from ..db.session import get_db
from ..schemas import ok
from ..schemas.share import (
    ShareFileCompleteRequest,
    ShareFileInitRequest,
    ShareMultiInitRequest,
)
from ..services.common import ServiceError
from ..services.share_multi import (
    complete_file,
    finalize_share,
    init_multi_share,
    register_file,
    verify_upload_token,
)

router = APIRouter(prefix="/api/share/multi", tags=["share-multi"])


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


def _bearer(authorization: str | None) -> str:
    """Extract token from 'Authorization: Bearer <token>'. 401 on missing."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail={"code": 4011, "message": "missing_upload_token", "detail": None},
        )
    return authorization[7:].strip()


# ── POST /api/share/multi/init ──────────────────────────────────────────────


@router.post("/init")
@limiter.limit(upload_limit())
async def share_multi_init(
    request: Request,
    response: Response,
    body: ShareMultiInitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Create a new multi-file share. Returns the pickup code + upload token."""
    ip = real_client_ip(request)
    try:
        out = await init_multi_share(
            db,
            declared_file_count=body.declared_file_count,
            declared_total_size=body.declared_total_size,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            ip=ip,
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ── POST /api/share/multi/{share_id}/file/init ──────────────────────────────


@router.post("/{share_id}/file/init")
async def share_multi_file_init(
    request: Request,
    body: ShareFileInitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    share_id: Annotated[int, Path(..., ge=1)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> dict[str, Any]:
    """Declare one file in the share; returns the per-file upload session id."""
    token = _bearer(authorization)
    try:
        verify_upload_token(token, expected_share_id=share_id)
        out = await register_file(
            db,
            share_id=share_id,
            name=body.name,
            size=body.size,
            content_type=body.content_type,
            declared_chunked=body.declared_chunked,
            chunk_size=body.chunk_size,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ── POST /api/share/multi/{share_id}/file/{file_id}/complete ────────────────


@router.post("/{share_id}/file/{file_id}/complete")
async def share_multi_file_complete(
    request: Request,
    body: ShareFileCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    share_id: Annotated[int, Path(..., ge=1)],
    file_id: Annotated[int, Path(..., ge=1)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> dict[str, Any]:
    """Finalize one file's upload — verifies size and flips state→complete."""
    token = _bearer(authorization)
    try:
        verify_upload_token(token, expected_share_id=share_id)
        out = await complete_file(
            db,
            share_id=share_id,
            file_id=file_id,
            etag_list=body.etag_list,
            total_uploaded_bytes=body.total_uploaded_bytes,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ── POST /api/share/multi/{share_id}/finalize ───────────────────────────────


@router.post("/{share_id}/finalize")
async def share_multi_finalize(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    share_id: Annotated[int, Path(..., ge=1)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> dict[str, Any]:
    """Mark the share finalized — all files must be in state='complete'."""
    token = _bearer(authorization)
    try:
        verify_upload_token(token, expected_share_id=share_id)
        out = await finalize_share(
            db,
            share_id=share_id,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)
