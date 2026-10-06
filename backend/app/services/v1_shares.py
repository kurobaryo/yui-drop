"""Owner-side share management for ``/api/v1``.

Everything here is scoped to the API key that created the share
(``filecodes.created_by_key_id``). A share owned by another key, an unknown
code and an already-deleted share are indistinguishable to the caller: all
answer 404 ``share_not_found``.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.access_log import AccessLogAction
from ..models.file_code import FileCode
from .common import NotFoundError, record_access


async def load_owned_live_share(
    db: AsyncSession, *, code: str, api_key_id: int
) -> FileCode:
    """The caller's not-yet-deleted share with this code, else 404."""
    row = (
        await db.execute(
            select(FileCode).where(
                FileCode.code == code,
                FileCode.created_by_key_id == api_key_id,
                FileCode.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if row is None:
        raise NotFoundError("share_not_found")
    return row


async def soft_revoke(
    db: AsyncSession,
    row: FileCode,
    *,
    ip: str | None,
    ua: str | None,
    event: str = "share.revoke",
) -> None:
    """Soft-delete ``row`` as revoked and commit.

    Uses the sweeper's ``deleted_at`` column, so pickup refuses the code at
    once and every download URL — including signed ones still inside their
    token window — answers 404. A multi share's files hang off the parent row
    and go with it. Stored objects are left for the admin recycle bin, like
    any other soft delete.
    """
    row.deleted_at = datetime.now(tz=UTC)
    row.deleted_reason = "revoked"
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=row.code,
        ip=ip,
        ua=ua,
        extra={"event": event, "share_id": row.id, "kind": row.kind},
    )
    await db.commit()


async def revoke_share(
    db: AsyncSession,
    *,
    code: str,
    api_key_id: int,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """``DELETE /api/v1/shares/{code}``."""
    row = await load_owned_live_share(db, code=code, api_key_id=api_key_id)
    await soft_revoke(db, row, ip=ip, ua=ua)
    return {"code": code, "deleted": True}


__all__ = ["load_owned_live_share", "revoke_share", "soft_revoke"]
