"""Retention sweeper.

Runs as a background task spawned from ``app.main`` lifespan. One pass does:

* Soft-delete shares whose ``expired_at`` has passed.
* Soft-delete shares whose ``expired_count`` reached zero.
* Abort orphan multipart sessions past their ``expires_at`` and remove their
  DB rows.

Soft-deletes leave rows in the DB so the admin recycle-bin / restore flow
works. Bucket objects survive soft delete; only ``hard`` admin actions or
post-soft-delete eviction (TBD) reach into storage.
"""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from ..core.config import settings
from ..core.logging import get_logger
from ..db.session import SessionLocal
from ..models.file_code import FileCode
from ..models.multipart_session import MultipartSession
from ..services.common import as_utc
from ..storage import get_storage

logger = get_logger(__name__)


async def sweep_once(
    db_factory: async_sessionmaker[Any] | None = None,
) -> dict[str, int]:
    """Run one retention pass. Returns ``{soft_deleted, orphans_aborted}``.

    ``db_factory`` defaults to the module-level ``SessionLocal`` from
    ``app.db.session`` — tests can pass a custom factory.
    """
    factory = db_factory or SessionLocal
    soft_deleted = 0
    aborted = 0
    async with factory() as db:
        now = datetime.now(tz=UTC)

        # Soft-delete expired (time-based). We pull rows and update one-by-one
        # so the timestamp on ``deleted_at`` is set in Python (DB-agnostic).
        q = select(FileCode).where(
            FileCode.deleted_at.is_(None),
            FileCode.expired_at.is_not(None),
        )
        for row in (await db.execute(q)).scalars():
            exp = as_utc(row.expired_at)
            if exp is not None and exp <= now:
                row.deleted_at = now
                soft_deleted += 1

        # Soft-delete expired (count-based).
        q2 = select(FileCode).where(
            FileCode.deleted_at.is_(None),
            FileCode.expired_count == 0,
        )
        for row in (await db.execute(q2)).scalars():
            row.deleted_at = now
            soft_deleted += 1

        # Abort orphan multiparts.
        storage = get_storage()
        q3 = select(MultipartSession)
        for sess in (await db.execute(q3)).scalars():
            sess_exp = as_utc(sess.expires_at)
            if sess_exp is None or sess_exp > now:
                continue
            try:
                await storage.abort_multipart(sess.key, sess.s3_upload_id)
            except Exception:  # noqa: BLE001 — best-effort cleanup
                logger.warning(
                    "retention.abort_multipart_failed",
                    upload_id=sess.upload_id,
                )
            await db.delete(sess)
            aborted += 1

        await db.commit()

    return {"soft_deleted": soft_deleted, "orphans_aborted": aborted}


async def sweeper_loop() -> None:
    """Forever loop: ``sweep_once`` every ``EXPIRE_SWEEPER_INTERVAL_MIN`` minutes.

    Cancellation (asyncio.CancelledError) propagates out cleanly so the
    lifespan can shut us down on app exit. All other exceptions are logged
    and swallowed — we never want the sweeper to die silently.
    """
    interval = max(1, settings.expire_sweeper_interval_min) * 60
    while True:
        try:
            stats = await sweep_once(SessionLocal)
            if stats["soft_deleted"] or stats["orphans_aborted"]:
                logger.info("retention.sweep", **stats)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("retention.sweep.error")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
