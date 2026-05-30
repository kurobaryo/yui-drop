"""Admin backoffice routes for collection (shared-room) management.

All endpoints depend on ``require_admin`` (Bearer JWT with role=admin) and
emit an ``admin_action`` access-log row via ``record_access`` for every
mutating call. Read-only listing also records an event so audits show who
peeked at the room inventory.

Routes:
    GET    /api/admin/collections                 list rooms (paginated)
    POST   /api/admin/collections/{id}/close      admin override close
    DELETE /api/admin/collections/{id}            hard delete (cascade) + R2 sweep
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.rate_limit import real_client_ip
from ..db.session import get_db
from ..models.access_log import AccessLogAction
from ..models.collection import Collection
from ..models.collection_file import CollectionFile
from ..models.collection_member import CollectionMember
from ..models.collection_message import CollectionMessage
from ..schemas import ok
from ..services import collections as svc
from ..services.common import ServiceError, record_access
from ..storage.factory import get_storage
from .deps import require_admin

router = APIRouter(prefix="/api/admin/collections", tags=["admin-collections"])


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


def _status_of(c: Collection, *, now: datetime) -> str:
    if c.closed_at is not None:
        return "closed"
    if c.expires_at is not None:
        # Compare naive-or-aware safely: coerce expires_at to UTC if naive.
        exp = c.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=UTC)
        if exp <= now:
            return "expired"
    return "active"


@router.get("", dependencies=[Depends(require_admin)])
async def list_collections(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    keyword: str = Query("", max_length=120),
    status: str = Query("all", pattern="^(all|active|closed|expired)$"),
) -> dict[str, Any]:
    """List rooms with member/file/message counts. Paginated + filterable."""
    now = datetime.now(tz=UTC)

    # Base query — keyword filter applies in SQL on code/name.
    stmt = select(Collection)
    if keyword:
        like = f"%{keyword}%"
        stmt = stmt.where((Collection.code.ilike(like)) | (Collection.name.ilike(like)))
    stmt = stmt.order_by(Collection.created_at.desc())

    # Pull a wide candidate set, then filter status in Python (status is
    # derived from closed_at + expires_at + now, not a stored column).
    # For an MVP with <100 rooms this is fine; if it grows we can push the
    # date comparison into SQL.
    all_rows = (await db.execute(stmt)).scalars().all()
    if status != "all":
        all_rows = [c for c in all_rows if _status_of(c, now=now) == status]

    total = len(all_rows)
    offset = (page - 1) * size
    page_rows = all_rows[offset : offset + size]

    items: list[dict[str, Any]] = []
    for c in page_rows:
        member_count = await db.scalar(
            select(func.count(CollectionMember.id)).where(CollectionMember.collection_id == c.id)
        )
        file_count = await db.scalar(
            select(func.count(CollectionFile.id)).where(
                CollectionFile.collection_id == c.id,
                CollectionFile.deleted_at.is_(None),
            )
        )
        message_count = await db.scalar(
            select(func.count(CollectionMessage.id)).where(
                CollectionMessage.collection_id == c.id,
                CollectionMessage.deleted_at.is_(None),
            )
        )
        items.append(
            {
                "id": c.id,
                "code": c.code,
                "name": c.name,
                "visibility": c.visibility,
                "status": _status_of(c, now=now),
                "upload_enabled": bool(c.upload_enabled),
                "expires_at": c.expires_at.isoformat() if c.expires_at else None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "member_count": int(member_count or 0),
                "file_count": int(file_count or 0),
                "message_count": int(message_count or 0),
            }
        )

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        status_code=200,
        extra={
            "event": "admin.collections.list",
            "page": page,
            "size": size,
            "keyword": keyword or None,
            "status": status,
            "total": total,
        },
    )
    await db.commit()
    return ok({"items": items, "total": total, "page": page, "size": size})


async def _load_by_id(db: AsyncSession, collection_id: int) -> Collection:
    res = await db.execute(select(Collection).where(Collection.id == collection_id))
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "collection_not_found"},
        )
    return row


@router.post("/{collection_id}/close", dependencies=[Depends(require_admin)])
async def close_collection(
    collection_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Admin override close — seals the room and emits the SSE 'closed' event."""
    collection = await _load_by_id(db, collection_id)
    try:
        await svc.admin_close(db, collection=collection)
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        status_code=200,
        extra={
            "event": "admin.collections.close",
            "collection_id": collection_id,
            "code": collection.code,
        },
    )
    await db.commit()
    return ok({"id": collection_id, "closed": True})


@router.delete("/{collection_id}", dependencies=[Depends(require_admin)])
async def delete_collection(
    collection_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Hard delete: cascade DB rows, best-effort wipe R2 objects under the prefix."""
    collection = await _load_by_id(db, collection_id)
    code = collection.code

    # Collect storage keys for best-effort cleanup BEFORE the cascade nukes the
    # CollectionFile rows. We rely on the DB as the source of truth for the
    # object keys under collection/{code}/ — the storage backends don't expose
    # a list-by-prefix primitive.
    key_rows = (
        await db.execute(
            select(CollectionFile.storage_key).where(CollectionFile.collection_id == collection.id)
        )
    ).all()
    keys = [r[0] for r in key_rows if r[0]]

    # DB cascade — relationships on Collection are configured with
    # cascade='all, delete-orphan' so members/files/messages go with it.
    await db.delete(collection)
    await db.flush()

    # Best-effort R2 sweep. Failures here must not roll back the DB delete:
    # the room is already gone from the user's perspective.
    storage_errors: str | None = None
    if keys:
        try:
            storage = get_storage()
            await storage.delete_many(keys)
        except Exception as exc:  # noqa: BLE001 — best-effort, log via audit
            storage_errors = repr(exc)

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        status_code=200,
        extra={
            "event": "admin.collections.delete",
            "collection_id": collection_id,
            "code": code,
            "deleted_keys": len(keys),
            "storage_errors": storage_errors,
        },
    )
    await db.commit()
    return ok({"id": collection_id, "deleted": True, "objects_swept": len(keys)})
