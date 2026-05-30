"""In-process pub/sub for Collection SSE streams.

Architecture
------------
This module maintains a module-level dict that maps a room id to the set of
active subscribers in this process. A subscriber is a small ``Subscriber``
dataclass that owns an ``asyncio.Queue`` for inbound events plus a
``member_id`` / ``is_creator`` tag used for visibility filtering at
broadcast time.

Limitations
-----------
This is **NOT cluster-safe** — events broadcast on one process are not
visible to subscribers connected to another. v0.3.0 ships single-host only;
swap this for a Redis pub/sub backend when scaling horizontally.

Public API
----------
* :func:`subscribe` — register a queue under a room, return a handle.
* :func:`unsubscribe` — drop a previously-registered handle.
* :func:`broadcast` — fan out an event payload to every subscriber whose
  visibility flags allow it.
* :func:`event_stream` — convenience async-generator suitable for use as
  the body of a starlette ``StreamingResponse(media_type='text/event-stream')``.
  Emits a 25-second SSE keepalive comment so intermediaries don't reap
  idle connections.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

# ── State ──────────────────────────────────────────────────────────────────


@dataclass
class Subscriber:
    """One active SSE listener for one room."""

    member_id: int
    is_creator: bool
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=asyncio.Queue)


# Module-level registry. Keyed by collection.id.
_subscribers: dict[int, set[Subscriber]] = {}
_lock = asyncio.Lock()


# Keepalive interval. SSE-friendly format is a comment line ``: keepalive\n\n``;
# 25 s comfortably beats the 30-60 s idle timeouts on most reverse proxies
# (Cloudflare, nginx, Apache) while staying cheap.
KEEPALIVE_SECONDS = 25.0


# ── subscribe / unsubscribe ────────────────────────────────────────────────


async def subscribe(collection_id: int, *, member_id: int, is_creator: bool) -> Subscriber:
    """Register a new subscriber for ``collection_id``.

    Returns the :class:`Subscriber` handle — the caller awaits on
    ``handle.queue.get()`` to receive events and MUST call
    :func:`unsubscribe` (typically in a ``finally`` block) when the SSE
    request ends, including the cancelled-task case.
    """
    sub = Subscriber(member_id=member_id, is_creator=is_creator)
    async with _lock:
        _subscribers.setdefault(collection_id, set()).add(sub)
    return sub


async def unsubscribe(collection_id: int, handle: Subscriber) -> None:
    """Remove a previously-registered subscriber. Safe to call twice."""
    async with _lock:
        bucket = _subscribers.get(collection_id)
        if bucket is None:
            return
        bucket.discard(handle)
        if not bucket:
            _subscribers.pop(collection_id, None)


def subscriber_count(collection_id: int) -> int:
    """Return the number of active subscribers (used by tests)."""
    bucket = _subscribers.get(collection_id)
    return len(bucket) if bucket else 0


# ── broadcast ──────────────────────────────────────────────────────────────


async def broadcast(
    collection_id: int,
    event_type: str,
    payload: dict[str, Any],
    *,
    creator_only: bool = False,
    only_member_id: int | None = None,
) -> None:
    """Fan out ``payload`` as a typed SSE event to subscribers of the room.

    Parameters
    ----------
    collection_id:
        Target room id. No-op if no subscribers are registered.
    event_type:
        SSE event name. The frontend dispatches on this (``message`` /
        ``file`` / ``deleted`` / ``closed``).
    payload:
        JSON-serialisable body. Sent verbatim as the SSE ``data:`` line.
    creator_only:
        When True (used for ``creator_only`` visibility), only deliver to
        subscribers whose ``is_creator`` flag is set OR whose
        ``member_id`` matches ``only_member_id`` (the uploader / author —
        they always see their own activity).
    only_member_id:
        Identifies the actor for ``creator_only`` filtering. Ignored when
        ``creator_only`` is False.
    """
    bucket = _subscribers.get(collection_id)
    if not bucket:
        return
    # Snapshot the set so concurrent unsubscribes during the broadcast
    # don't raise RuntimeError("Set changed size during iteration").
    for sub in list(bucket):
        if creator_only and not sub.is_creator and sub.member_id != only_member_id:
            continue
        try:
            sub.queue.put_nowait({"event": event_type, "data": payload})
        except asyncio.QueueFull:
            # Per-subscriber back-pressure: drop the oldest event then
            # try again. Queues are unbounded by default so this branch
            # is mostly defensive.
            try:
                sub.queue.get_nowait()
                sub.queue.put_nowait({"event": event_type, "data": payload})
            except Exception:
                pass


async def broadcast_closed(collection_id: int) -> None:
    """Tell every subscriber the room is gone, then drop them.

    The frontend treats ``closed`` as terminal — it shows a 'Room closed'
    overlay and stops reconnecting. We still send the event through the
    queue (rather than ripping the queue out) so the consumer sees it
    before the stream ends.
    """
    bucket = list(_subscribers.get(collection_id, ()))
    for sub in bucket:
        try:
            sub.queue.put_nowait({"event": "closed", "data": {}})
            # Sentinel: tells :func:`event_stream` to exit cleanly.
            sub.queue.put_nowait({"event": "__stop__", "data": {}})
        except Exception:
            pass


# ── SSE event generator ────────────────────────────────────────────────────


def _format_event(event_type: str, payload: dict[str, Any]) -> bytes:
    """Render one event in the SSE wire format."""
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return f"event: {event_type}\ndata: {body}\n\n".encode()


async def event_stream(handle: Subscriber) -> AsyncIterator[bytes]:
    """Yield raw SSE-encoded bytes for one subscriber.

    Emits a ``: keepalive`` comment every ``KEEPALIVE_SECONDS`` even when
    no event is queued — many reverse proxies (Cloudflare, nginx default
    config) close idle streams after ~30 s without any bytes flowing.

    The generator exits when an ``__stop__`` sentinel is received (set by
    :func:`broadcast_closed`) or when the underlying task is cancelled.
    """
    # Send an initial comment so the browser opens the EventSource state
    # machine immediately; the empty data line is invalid SSE so we use a
    # comment line (``: ready``) instead.
    yield b": ready\n\n"
    try:
        while True:
            try:
                msg = await asyncio.wait_for(handle.queue.get(), timeout=KEEPALIVE_SECONDS)
            except TimeoutError:
                yield b": keepalive\n\n"
                continue
            event_type = msg.get("event")
            if event_type == "__stop__":
                return
            yield _format_event(event_type or "message", msg.get("data") or {})
    except asyncio.CancelledError:
        # Re-raise so the caller's ``finally`` block runs unsubscribe.
        raise


__all__ = [
    "Subscriber",
    "subscribe",
    "unsubscribe",
    "broadcast",
    "broadcast_closed",
    "event_stream",
    "subscriber_count",
    "KEEPALIVE_SECONDS",
]
