"""Chunked-upload endpoints (server-proxied)."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.rate_limit import limiter, real_client_ip, upload_limit
from ..db.session import get_db
from ..schemas import ok
from ..schemas.chunk import ChunkCompleteRequest, ChunkInitRequest
from ..services.admin_turnstile import resolve_turnstile_config
from ..services.chunk import (
    abort_chunk_upload,
    complete_chunk_upload,
    get_chunk_status,
    init_chunk_upload,
    save_chunk,
)
from ..services.common import ServiceError
from ..services.turnstile import verify_turnstile

router = APIRouter(prefix="/api/chunk", tags=["chunk"])


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


async def _turnstile_gate_upload(
    request: Request,
    db: AsyncSession,
    token: str | None,
) -> JSONResponse | None:
    """Mirror of the gate in presign.py — only enforced when turnstile is
    fully enabled and ``protect_upload`` is on. Returns the 4003 envelope on
    failure, ``None`` to proceed.
    """
    cfg = await resolve_turnstile_config(db)
    if not cfg.get("enabled") or not cfg.get("protect_upload"):
        return None
    if not cfg.get("secret_key"):
        return None
    ok_ = await verify_turnstile(token or "", remote_ip=real_client_ip(request), db=db)
    if not ok_:
        return JSONResponse(
            status_code=400,
            content={"code": 4003, "message": "turnstile_failed"},
        )
    return None



# ────────────────────────────────────────────────────────────────────────────
# POST /api/chunk/upload/init
# ────────────────────────────────────────────────────────────────────────────


@router.post("/upload/init")
@limiter.limit(upload_limit())
async def chunk_init(
    request: Request,
    response: Response,
    body: ChunkInitRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    gate = await _turnstile_gate_upload(request, db, body.turnstile_token)
    if gate is not None:
        return gate
    try:
        out = await init_chunk_upload(
            db,
            file_name=body.file_name,
            file_size=body.file_size,
            chunk_size=body.chunk_size,
            file_hash=body.file_hash,
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
# POST /api/chunk/upload/{upload_id}/{chunk_index}
# ────────────────────────────────────────────────────────────────────────────


@router.post("/upload/{upload_id}/{chunk_index}")
async def chunk_part(
    request: Request,
    upload_id: str,
    chunk_index: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    chunk: Annotated[UploadFile, File(...)],
) -> dict[str, Any]:
    data = await chunk.read()
    try:
        out = await save_chunk(db, upload_id=upload_id, chunk_index=chunk_index, data=data)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/chunk/upload/{upload_id}
# ────────────────────────────────────────────────────────────────────────────


@router.get("/upload/{upload_id}")
async def chunk_status(
    request: Request,
    upload_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await get_chunk_status(db, upload_id=upload_id)
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/chunk/upload/{upload_id}/complete
# ────────────────────────────────────────────────────────────────────────────


@router.post("/upload/{upload_id}/complete")
async def chunk_complete(
    request: Request,
    upload_id: str,
    body: ChunkCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await complete_chunk_upload(
            db,
            upload_id=upload_id,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            ip=real_client_ip(request),
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# DELETE /api/chunk/upload/{upload_id}
# ────────────────────────────────────────────────────────────────────────────


@router.delete("/upload/{upload_id}")
async def chunk_abort(
    request: Request,
    upload_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    try:
        out = await abort_chunk_upload(
            db, upload_id=upload_id, ip=real_client_ip(request), ua=_ua(request)
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)
