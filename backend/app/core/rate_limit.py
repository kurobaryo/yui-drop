"""Rate limiting + per-IP brute-force tracking.

Two pieces:

* ``limiter`` — slowapi ``Limiter`` instance using the real client IP
  (X-Forwarded-For aware).
* ``retrieve_fail_tracker`` — in-process per-IP counter of failed retrieves
  within a sliding 1-hour window. Guarded by an asyncio.Lock so it's safe to
  call from any async handler. Swap for Redis when scaling horizontally.

``upload_limit`` exposes the slowapi limit string composed from the configured
per-minute / per-hour / per-day caps; route handlers can decorate themselves
with ``@limiter.limit(upload_limit)`` (slowapi accepts callables that return a
string).
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import settings


def real_client_ip(request: Request) -> str:
    """Resolve the originating client IP from a (possibly proxied) request.

    Walks ``X-Forwarded-For`` right-to-left and returns the first entry that
    parses as a valid IPv4/IPv6 address. Cloudflare's orange-cloud appends
    its own edge IP at the end of XFF, so the rightmost-compliant value is
    the closest hop we can trust. Falls back to ``X-Real-IP`` and finally to
    ``request.client.host``.

    See :mod:`app.core.request_ip` for the audit-toggle-aware variant used
    when writing AccessLog rows.
    """
    # Local import to avoid a cycle (request_ip imports SettingsKV which
    # transitively pulls in db wiring; rate_limit is loaded earlier).
    from .request_ip import _parse_xff

    xff = request.headers.get("x-forwarded-for")
    if xff:
        parsed = _parse_xff(xff)
        if parsed:
            return parsed
    xri = request.headers.get("x-real-ip")
    if xri:
        return xri.strip()
    return get_remote_address(request)


# ── slowapi limiter ─────────────────────────────────────────────────────────

limiter = Limiter(key_func=real_client_ip, headers_enabled=True)


def upload_limit() -> str:
    """Return the combined upload limit string for slowapi.

    slowapi treats multiple windows separated by ';' as AND-ed limits.
    Example: '5/minute;30/hour;200/day'.
    """
    return (
        f"{settings.rate_limit_upload_per_min}/minute;"
        f"{settings.rate_limit_upload_per_hour}/hour;"
        f"{settings.rate_limit_upload_per_day}/day"
    )


def login_limit() -> str:
    """Per-IP admin login limit string for slowapi."""
    return f"{settings.rate_limit_login_per_5min}/5minutes"


# ── In-process retrieve-failure tracker ────────────────────────────────────


class RetrieveFailTracker:
    """Sliding 1-hour window of failed-retrieve attempts, keyed by IP.

    Internals:
        ``_fails``: ``dict[str, deque[float]]`` — per-IP timestamps of failures.
        ``_bans``:  ``dict[str, float]`` — IPs banned until the given unix ts.
        ``_lock``:  ``asyncio.Lock`` — guards all mutating operations.

    Suitable for single-process deployments. For multi-worker / multi-host
    setups, replace with a Redis-backed implementation that exposes the same
    coroutine surface.
    """

    def __init__(self, window_seconds: int = 3600) -> None:
        self.window = window_seconds
        self._fails: dict[str, deque[float]] = defaultdict(deque)
        self._bans: dict[str, float] = {}
        self._lock = asyncio.Lock()

    def _prune_locked(self, ip: str, now: float) -> None:
        dq = self._fails[ip]
        cutoff = now - self.window
        while dq and dq[0] < cutoff:
            dq.popleft()

    async def is_banned(self, ip: str) -> bool:
        """Return True iff this IP is currently within a ban window."""
        async with self._lock:
            now = time.time()
            until = self._bans.get(ip, 0.0)
            if until and now < until:
                return True
            if until and now >= until:
                del self._bans[ip]
            return False

    async def count(self, ip: str) -> int:
        """Return the number of failures recorded in the current window."""
        async with self._lock:
            now = time.time()
            self._prune_locked(ip, now)
            return len(self._fails[ip])

    async def record_failure(self, ip: str) -> int:
        """Record one failure. Returns the resulting count in the window.

        Ban logic (threshold + ban duration) is left to the caller so policy
        stays in one place (the retrieval handler) rather than scattered.
        """
        async with self._lock:
            now = time.time()
            self._prune_locked(ip, now)
            self._fails[ip].append(now)
            return len(self._fails[ip])

    async def ban(self, ip: str, duration_seconds: int) -> None:
        """Ban an IP for ``duration_seconds`` and clear its failure deque."""
        async with self._lock:
            self._bans[ip] = time.time() + duration_seconds
            self._fails[ip].clear()

    async def record_success(self, ip: str) -> None:
        """Drop any tracked failures for this IP."""
        async with self._lock:
            self._fails.pop(ip, None)

    async def reset(self) -> None:
        """Test helper: drop all state."""
        async with self._lock:
            self._fails.clear()
            self._bans.clear()


retrieve_fail_tracker = RetrieveFailTracker()
