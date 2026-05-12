"""S3 presigned-URL multipart endpoints."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.rate_limit import limiter, real_client_ip, upload_limit
from ..db.session import get_db
from ..schemas import ok
from ..schemas.presign import (
    PresignCompleteRequest,
    PresignInitRequest,
    PresignSignPartRequest,
)
from ..services.common import ServiceError
from ..services.presign import (
    abort_presign_upload,
    complete_presign_upload,
    get_presign_status,
    init_presign_upload,
    sign_presign_part,
)

router = APIRouter(prefix="/api/presign", tags=["presign"])


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


# ────────────────────────────────────────────────────────────────────────────
# POST /api/presign/init
# ────────────────────────────────────────────────────────────────────────────


@router.post("/init")
@limiter.limit(upload_limit())
async def presign_init(
    request: Request,
    response: Response,
    body: PresignInitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await init_presign_upload(
            db,
            file_name=body.file_name,
            file_size=body.file_size,
            content_type=body.content_type,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/presign/{upload_id}/sign-part
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{upload_id}/sign-part")
async def presign_sign_part(
    request: Request,
    upload_id: str,
    body: PresignSignPartRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await sign_presign_part(db, upload_id=upload_id, part_number=body.part_number)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/presign/{upload_id}/complete
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{upload_id}/complete")
async def presign_complete(
    request: Request,
    upload_id: str,
    body: PresignCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await complete_presign_upload(
            db,
            upload_id=upload_id,
            parts=[p.model_dump() for p in body.parts],
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# DELETE /api/presign/{upload_id}
# ────────────────────────────────────────────────────────────────────────────


@router.delete("/{upload_id}")
async def presign_abort(
    request: Request,
    upload_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await abort_presign_upload(
            db, upload_id=upload_id, ip=real_client_ip(request), ua=_ua(request)
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/presign/{upload_id}
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{upload_id}")
async def presign_status(
    request: Request,
    upload_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await get_presign_status(db, upload_id=upload_id)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)
