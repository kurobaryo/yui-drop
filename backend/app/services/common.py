"""Shared service helpers — expiry computation, audit logging, errors."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..models.access_log import AccessLog, AccessLogAction


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite stores naive datetimes even when the column is ``DateTime(timezone=True)``.

    Treat any incoming naive datetime as already being in UTC so that comparisons
    against ``datetime.now(tz=UTC)`` never raise ``TypeError``. Aware datetimes are
    returned unchanged.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt




class ServiceError(Exception):
    """Application-level error with a numeric ``code`` and HTTP status."""

    def __init__(
        self,
        message: str,
        *,
        code: int = 4000,
        http_status: int = 400,
        detail: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status
        self.detail = detail


class NotFoundError(ServiceError):
    def __init__(self, message: str = "not_found", **kw: Any) -> None:
        super().__init__(message, code=4040, http_status=404, **kw)


class ForbiddenError(ServiceError):
    def __init__(self, message: str = "forbidden", **kw: Any) -> None:
        super().__init__(message, code=4030, http_status=403, **kw)


class RateLimitedError(ServiceError):
    def __init__(self, message: str = "rate_limited", **kw: Any) -> None:
        super().__init__(message, code=4291, http_status=429, **kw)


# ── Expiry helpers ──────────────────────────────────────────────────────────


def compute_expiry(
    expire_value: int,
    expire_style: str,
    *,
    now: datetime | None = None,
) -> tuple[datetime | None, int]:
    """Translate a ``(value, style)`` pair into ``(expired_at, expired_count)``.

    Styles:
        ``count``   — ``expired_count = value``, ``expired_at = None``.
        ``forever`` — both fields ``None`` / ``-1``.
        anything else (``minute``/``hour``/``day``/``week``/``month``/``year``):
            ``expired_at = now + N <units>``, ``expired_count = -1``.

    ``-1`` here matches the FileCode default and means "unlimited retrievals".
    """
    now = now or datetime.now(tz=UTC)
    style = expire_style.lower()
    if style == "forever":
        return None, -1
    if style == "count":
        # Defensive lower-bound; the request validator already enforces ge=1.
        return None, max(1, int(expire_value))

    unit_map = {
        "minute": timedelta(minutes=1),
        "hour": timedelta(hours=1),
        "day": timedelta(days=1),
        "week": timedelta(weeks=1),
        # 30/365 days is the conventional approximation; month/year are not
        # exact wall-clock units. The orphan sweeper uses the same value.
        "month": timedelta(days=30),
        "year": timedelta(days=365),
    }
    delta = unit_map.get(style)
    if delta is None:
        raise ValueError(f"unknown expire_style: {expire_style!r}")
    return now + delta * max(1, int(expire_value)), -1


# ── Audit log ───────────────────────────────────────────────────────────────


async def record_access(
    db: AsyncSession,
    *,
    action: AccessLogAction,
    code: str | None = None,
    ip: str | None = None,
    ua: str | None = None,
    status_code: int = 200,
    extra: dict[str, Any] | None = None,
) -> None:
    """Append one AccessLog row. Caller is responsible for commit semantics."""
    row = AccessLog(
        action=action,
        code=code,
        ip=ip,
        ua=ua,
        status_code=status_code,
        extra=extra,
    )
    db.add(row)
