"""Per-API-key quota enforcement and daily-usage rollup.

Two responsibilities:

* :func:`check_can_upload` — pre-flight guard called BEFORE any bytes are
  accepted. Validates the proposed upload against the per-key
  ``max_file_size`` and ``quota_daily_bytes`` ceilings.
* :func:`record_usage` — post-success accounting, called AFTER the upload
  has been persisted. Atomically upserts today's ``api_key_usage`` row.

Concurrency note: ``record_usage`` commits its own transaction so a
follow-up call from a concurrent request observes the bumped totals on its
next ``check_can_upload``.
"""
from __future__ import annotations

from datetime import UTC, datetime

import structlog
from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.api_key import ApiKey
from ..models.api_key_usage import ApiKeyUsage
from .common import ServiceError

log = structlog.get_logger(__name__)


async def check_can_upload(
    db: AsyncSession,
    api_key: ApiKey,
    *,
    file_size: int,
) -> None:
    """Raise a ``ServiceError`` if ``file_size`` would breach this key's quotas.

    * ``max_file_size`` is a hard per-call cap (413 ``file_too_large``).
    * ``quota_daily_bytes`` is a 24-hour rolling-UTC-day budget. A value of
      ``0`` is treated as "unlimited" and skips the daily check entirely.
    """
    if file_size > api_key.max_file_size:
        raise ServiceError(
            "file_too_large",
            code=4293,
            http_status=413,
            detail={"max_bytes": api_key.max_file_size},
        )

    # 0 = unlimited daily quota — skip the rollup lookup.
    if api_key.quota_daily_bytes <= 0:
        return

    today = datetime.now(UTC).date()
    row = (
        await db.execute(
            select(ApiKeyUsage).where(
                ApiKeyUsage.api_key_id == api_key.id,
                ApiKeyUsage.date == today,
            )
        )
    ).scalars().first()
    used = int(row.total_bytes) if row is not None else 0
    if used + file_size > api_key.quota_daily_bytes:
        raise ServiceError(
            "daily_quota_exceeded",
            code=4292,
            http_status=429,
            detail={"limit": api_key.quota_daily_bytes, "used": used},
        )


async def record_usage(
    db: AsyncSession,
    api_key: ApiKey,
    *,
    bytes_used: int,
) -> None:
    """Atomically bump today's usage row for ``api_key``.

    Tries the SQLite ON CONFLICT DO UPDATE path first (which is the prod
    deployment). On other backends (e.g. Postgres) it falls back to a plain
    SELECT-then-UPDATE/INSERT inside a fresh transaction.

    Failures are intentionally swallowed: we'd rather under-account a
    successful upload than 500 the response. The failure is logged at warn.
    """
    today = datetime.now(UTC).date()
    try:
        stmt = (
            sqlite_insert(ApiKeyUsage)
            .values(
                api_key_id=api_key.id,
                date=today,
                total_bytes=bytes_used,
                total_calls=1,
            )
            .on_conflict_do_update(
                index_elements=["api_key_id", "date"],
                set_={
                    "total_bytes": ApiKeyUsage.total_bytes + bytes_used,
                    "total_calls": ApiKeyUsage.total_calls + 1,
                    "updated_at": datetime.now(UTC),
                },
            )
        )
        await db.execute(stmt)
        await db.commit()
        return
    except Exception as exc:  # noqa: BLE001 — SQLite path may not be in use
        log.debug(
            "api_quota.sqlite_upsert_failed_fallback",
            key_id=api_key.key_id,
            err=str(exc),
        )
        try:
            await db.rollback()
        except Exception:
            pass

    # Fallback: SELECT-then-UPDATE/INSERT. Good enough for low-contention
    # Postgres deployments; if we ever hit real concurrency we'll switch to
    # the dialect-specific ON CONFLICT statement.
    try:
        existing = (
            await db.execute(
                select(ApiKeyUsage).where(
                    ApiKeyUsage.api_key_id == api_key.id,
                    ApiKeyUsage.date == today,
                )
            )
        ).scalars().first()
        if existing is None:
            db.add(
                ApiKeyUsage(
                    api_key_id=api_key.id,
                    date=today,
                    total_bytes=bytes_used,
                    total_calls=1,
                )
            )
        else:
            await db.execute(
                update(ApiKeyUsage)
                .where(ApiKeyUsage.id == existing.id)
                .values(
                    total_bytes=ApiKeyUsage.total_bytes + bytes_used,
                    total_calls=ApiKeyUsage.total_calls + 1,
                    updated_at=datetime.now(UTC),
                )
            )
        await db.commit()
    except Exception:  # noqa: BLE001 — non-fatal accounting failure
        log.warning("api_quota.record_usage_failed", key_id=api_key.key_id)
        try:
            await db.rollback()
        except Exception:
            pass
