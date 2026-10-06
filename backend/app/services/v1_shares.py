"""Owner-side share management for ``/api/v1``.

Everything here is scoped to the API key that created the share
(``filecodes.created_by_key_id``). A share owned by another key, an unknown
code and an already-deleted share are indistinguishable to the caller: all
answer 404 ``share_not_found``.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..models.access_log import AccessLogAction
from ..models.file_code import FileCode
from ..models.share_file import ShareFile
from .common import NotFoundError, as_utc, record_access
from .inline_policy import served_type

ShareStatus = Literal["active", "expired", "revoked"]


# ── Status ──────────────────────────────────────────────────────────────────


def share_status(row: FileCode, now: datetime | None = None) -> ShareStatus:
    """``active`` | ``expired`` | ``revoked`` as shown to the owner.

    Soft-deleted rows say why they went: ``deleted_reason``. Rows deleted
    before that column existed (or by an admin) carry no reason; they count
    as expired when their time or count had run out, else as revoked.
    """
    now = now or datetime.now(tz=UTC)
    expired_at = as_utc(row.expired_at)
    if row.deleted_at is not None:
        if row.deleted_reason in ("expired", "revoked"):
            return row.deleted_reason  # type: ignore[return-value]
        deleted_at = as_utc(row.deleted_at)
        ran_out = row.expired_count == 0 or (
            expired_at is not None and deleted_at is not None and expired_at <= deleted_at
        )
        return "expired" if ran_out else "revoked"
    if row.expired_count == 0 or (expired_at is not None and expired_at <= now):
        return "expired"
    return "active"


def _history_cutoff(now: datetime) -> datetime:
    return now - timedelta(days=settings.share_history_days)


# ── Listing ─────────────────────────────────────────────────────────────────


async def list_owned_shares(
    db: AsyncSession,
    *,
    api_key_id: int,
    status: str,
    limit: int,
    offset: int,
) -> tuple[int, list[FileCode]]:
    """``(total, rows)`` for ``GET /api/v1/shares``.

    * ``active``  — live, not past its time, count not used up.
    * ``expired`` — live but run out, plus rows swept or revoked within the
      last ``SHARE_HISTORY_DAYS`` (metadata only; their objects are gone the
      usual way).
    * ``all``     — both.

    Multi shares still being uploaded are never listed.
    """
    now = datetime.now(tz=UTC)
    live = FileCode.deleted_at.is_(None)
    recent_deleted = FileCode.deleted_at.is_not(None) & (
        FileCode.deleted_at >= _history_cutoff(now)
    )
    ran_out = (
        (FileCode.expired_at.is_not(None) & (FileCode.expired_at <= now))
        | (FileCode.expired_count == 0)
    )
    base = [FileCode.created_by_key_id == api_key_id, FileCode.finalized.is_(True)]
    if status == "active":
        where = base + [live, ~ran_out]
    elif status == "expired":
        where = base + [(live & ran_out) | recent_deleted]
    else:
        where = base + [live | recent_deleted]

    total = int(
        (await db.execute(select(func.count()).select_from(FileCode).where(*where))).scalar_one()
    )
    rows = (
        await db.execute(
            select(FileCode)
            .where(*where)
            .order_by(FileCode.created_at.desc(), FileCode.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return total, list(rows)


async def load_owned_share(db: AsyncSession, *, code: str, api_key_id: int) -> FileCode:
    """The caller's share for ``GET /api/v1/shares/{code}``, else 404.

    Includes revoked / swept rows still inside the history window, so a
    detail view can show what happened to the share.
    """
    now = datetime.now(tz=UTC)
    row = (
        await db.execute(
            select(FileCode).where(
                FileCode.code == code,
                FileCode.created_by_key_id == api_key_id,
                FileCode.finalized.is_(True),
                FileCode.deleted_at.is_(None)
                | (FileCode.deleted_at >= _history_cutoff(now)),
            )
        )
    ).scalars().first()
    if row is None:
        raise NotFoundError("share_not_found")
    return row


async def list_member_files(db: AsyncSession, share: FileCode) -> list[dict[str, Any]]:
    """Complete member files of a multi share, pickup-shaped minus URLs."""
    rows = (
        await db.execute(
            select(ShareFile)
            .where(ShareFile.share_id == share.id, ShareFile.state == "complete")
            .order_by(ShareFile.order)
        )
    ).scalars().all()
    out = []
    for sf in rows:
        ct, inline_ok = served_type(sf.name, sf.suffix)
        out.append({
            "file_id": sf.id,
            "order": sf.order,
            "name": sf.name,
            "size": sf.size,
            "content_type": ct,
            "force_download": not inline_ok,
        })
    return out


# ── Revoke ──────────────────────────────────────────────────────────────────


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
    """``DELETE /api/v1/shares/{code}``.

    A multi share still being uploaded has nothing worth keeping, so it is
    discarded outright, exactly like ``DELETE /api/v1/share/multi/{id}``.
    """
    row = await load_owned_live_share(db, code=code, api_key_id=api_key_id)
    if row.kind == "multi" and not row.finalized:
        from .v1_multi import discard_open_share

        await discard_open_share(db, row, ip=ip, ua=ua, event="share.revoke.unfinalized")
    else:
        await soft_revoke(db, row, ip=ip, ua=ua)
    return {"code": code, "deleted": True}


__all__ = [
    "ShareStatus",
    "list_member_files",
    "list_owned_shares",
    "load_owned_live_share",
    "load_owned_share",
    "revoke_share",
    "share_status",
    "soft_revoke",
]
