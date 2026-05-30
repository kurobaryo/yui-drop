"""In-process presence tracker for collection-room members.

The collaboration UX wants to show "last seen" timestamps for each member of
a room. The naïve implementation — `UPDATE member SET last_seen_at = NOW()`
on every request — turns into the dominant write workload once SSE clients
are polling and produces SQLite write-lock contention even with WAL +
busy_timeout (see v0.3.4 incident).

This module decouples the timestamp write from the request path:

* Request handlers call :func:`touch` with the member's id. This is a
  synchronous in-memory dict update — zero I/O, zero locks.
* A lifespan-managed coroutine wakes up every ``FLUSH_INTERVAL_SECONDS``,
  drains the pending dict, and issues a single batched ``UPDATE`` in one
  short transaction. The write lock is held for milliseconds, not the
  lifetime of an SSE connection.

We accept the small UX cost: a member who disconnects right after touching
won't have their ``last_seen_at`` flushed for up to ``FLUSH_INTERVAL_SECONDS``
seconds. Since the field is only used for "who's online" heuristics, that's
fine.

Architectural note: keeping this in-process means we MUST run uvicorn with
``--workers 1`` (the default in our docker setup). When yui-drop ever needs
multiple workers, replace the in-memory dict with a Redis SET / Redis stream
and the public API stays the same.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import update

from ..db.session import SessionLocal
from ..models.collection_member import CollectionMember

log = logging.getLogger(__name__)

# How often the background task flushes pending touches to the database.
# Matches the 60s last_seen_at throttle we used to apply per-request; the
# absolute write rate drops further because we batch all members in one UPDATE.
FLUSH_INTERVAL_SECONDS = 60

# Module-level state — see __init__ docstring for the lifecycle rationale.
_pending: dict[int, datetime] = {}
_flush_task: asyncio.Task[None] | None = None


def touch(member_id: int) -> None:
    """Mark ``member_id`` as having been seen now.

    Synchronous and lock-free — the dict assignment is atomic enough for
    asyncio (single-threaded event loop). Safe to call from any request
    handler, including SSE generators.

    The actual ``UPDATE`` happens in the background flush loop, not here.
    """
    _pending[member_id] = datetime.now(tz=UTC)


async def _flush_once() -> None:
    """Drain ``_pending`` and write it out in one short transaction."""
    if not _pending:
        return
    # Swap-then-iterate so new touches during the flush don't get lost or
    # double-written.
    snapshot = _pending.copy()
    _pending.clear()

    async with SessionLocal() as session:
        try:
            for member_id, seen_at in snapshot.items():
                await session.execute(
                    update(CollectionMember)
                    .where(CollectionMember.id == member_id)
                    .values(last_seen_at=seen_at)
                )
            await session.commit()
        except Exception:
            await session.rollback()
            # Re-queue the touches we failed to persist so the next flush
            # retries them. New touches that arrived during the failed flush
            # may have newer timestamps — keep whichever is later.
            for member_id, seen_at in snapshot.items():
                existing = _pending.get(member_id)
                if existing is None or existing < seen_at:
                    _pending[member_id] = seen_at
            log.exception("presence.flush_failed", extra={"count": len(snapshot)})


async def _flush_loop() -> None:
    """Run the flush every ``FLUSH_INTERVAL_SECONDS`` until cancelled."""
    try:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
            await _flush_once()
    except asyncio.CancelledError:
        # Final flush so we don't leak pending touches on shutdown.
        try:
            await _flush_once()
        except Exception:
            log.exception("presence.final_flush_failed")
        raise


def start() -> None:
    """Spawn the flush loop. Idempotent — safe to call from lifespan startup."""
    global _flush_task
    if _flush_task is not None and not _flush_task.done():
        return
    _flush_task = asyncio.create_task(_flush_loop(), name="presence_flush_loop")


async def stop() -> None:
    """Cancel the flush loop and run one last flush. Safe to call from lifespan shutdown."""
    global _flush_task
    if _flush_task is None:
        return
    _flush_task.cancel()
    try:
        await _flush_task
    except asyncio.CancelledError:
        pass
    _flush_task = None


def pending_count() -> int:
    """Number of unflushed touches. Exposed for tests / health endpoints."""
    return len(_pending)


__all__ = [
    "touch",
    "start",
    "stop",
    "pending_count",
    "FLUSH_INTERVAL_SECONDS",
]
