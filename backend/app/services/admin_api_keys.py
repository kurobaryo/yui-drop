"""Admin-side service for issuing and managing /api/v1 keys."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.api_auth import generate_api_key
from ..models.access_log import AccessLogAction
from ..models.api_key import ApiKey
from ..models.api_key_usage import ApiKeyUsage
from .common import NotFoundError, ServiceError, record_access

# Scopes accepted on creation/update. Keep this in lock-step with the
# ``Scope`` Literal in ``app.schemas.admin_api_keys``.
VALID_SCOPES: frozenset[str] = frozenset({"upload", "read"})

# Sentinel used by ``update_api_key`` to distinguish "field omitted by the
# caller" from "field explicitly set to None" (e.g. clear ``expires_at``).
_UNSET: Any = object()


def _serialize(row: ApiKey, *, now: datetime | None = None) -> dict[str, Any]:
    """Build the dict shape returned by list/get/create/update/revoke."""
    now = now or datetime.now(UTC)
    return {
        "id": row.id,
        "key_id": row.key_id,
        "note": row.note,
        "scopes": row.scopes_list(),
        "quota_daily_bytes": row.quota_daily_bytes,
        "quota_per_minute": row.quota_per_minute,
        "max_file_size": row.max_file_size,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "created_at": row.created_at.isoformat(),
        "created_by_admin": row.created_by_admin,
        "is_active": row.is_active(now),
    }


def _validate_scopes(scopes: list[str]) -> list[str]:
    """Return a normalised, sorted, deduped list. Raise on empty/invalid."""
    if not scopes:
        raise ServiceError(
            "invalid_scopes",
            code=4001,
            http_status=400,
            detail={"valid": sorted(VALID_SCOPES)},
        )
    bad = [s for s in scopes if s not in VALID_SCOPES]
    if bad:
        raise ServiceError(
            "invalid_scopes",
            code=4001,
            http_status=400,
            detail={"valid": sorted(VALID_SCOPES), "invalid": bad},
        )
    return sorted(set(scopes))


async def list_api_keys(db: AsyncSession) -> list[dict[str, Any]]:
    """Return every API key, most-recently-created first. No secrets included."""
    stmt = select(ApiKey).order_by(desc(ApiKey.created_at))
    res = await db.execute(stmt)
    now = datetime.now(UTC)
    return [_serialize(row, now=now) for row in res.scalars().all()]


async def create_api_key(
    db: AsyncSession,
    *,
    note: str | None,
    scopes: list[str],
    quota_daily_bytes: int,
    quota_per_minute: int,
    max_file_size: int,
    expires_in_days: int | None,
    created_by_admin: str | None,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Mint a new API key. Returns the row dict PLUS ``plaintext`` (shown once)."""
    normalised_scopes = _validate_scopes(scopes)

    if quota_daily_bytes < 0:
        raise ServiceError(
            "invalid_quota",
            code=4001,
            http_status=400,
            detail={"field": "quota_daily_bytes", "min": 0},
        )
    if quota_per_minute < 1:
        raise ServiceError(
            "invalid_quota",
            code=4001,
            http_status=400,
            detail={"field": "quota_per_minute", "min": 1},
        )
    if max_file_size < 1:
        raise ServiceError(
            "invalid_quota",
            code=4001,
            http_status=400,
            detail={"field": "max_file_size", "min": 1},
        )
    if expires_in_days is not None and expires_in_days < 1:
        raise ServiceError(
            "invalid_expiry",
            code=4001,
            http_status=400,
            detail={"field": "expires_in_days", "min": 1},
        )

    plaintext_full, key_id, key_hash = generate_api_key()

    now = datetime.now(UTC)
    expires_at = now + timedelta(days=expires_in_days) if expires_in_days else None

    row = ApiKey(
        key_id=key_id,
        key_hash=key_hash,
        note=note,
        scopes=",".join(normalised_scopes),
        quota_daily_bytes=quota_daily_bytes,
        quota_per_minute=quota_per_minute,
        max_file_size=max_file_size,
        expires_at=expires_at,
        created_by_admin=created_by_admin,
    )
    db.add(row)
    await db.flush()  # populate row.id and server-default created_at

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        extra={
            "event": "admin.api_key.create",
            "key_id": key_id,
            "scopes": normalised_scopes,
            "note": note,
        },
    )
    await db.commit()
    await db.refresh(row)

    out = _serialize(row)
    out["plaintext"] = plaintext_full
    return out


async def _load(db: AsyncSession, key_pk: int) -> ApiKey:
    row = await db.get(ApiKey, key_pk)
    if row is None:
        raise NotFoundError("api_key_not_found", detail={"id": key_pk})
    return row


async def get_api_key(db: AsyncSession, *, key_pk: int) -> dict[str, Any]:
    """Fetch one API key by primary key. Raises ``NotFoundError`` if missing."""
    row = await _load(db, key_pk)
    return _serialize(row)


async def update_api_key(
    db: AsyncSession,
    *,
    key_pk: int,
    note: str | None = _UNSET,
    scopes: list[str] | None = _UNSET,
    quota_daily_bytes: int | None = _UNSET,
    quota_per_minute: int | None = _UNSET,
    max_file_size: int | None = _UNSET,
    expires_at: datetime | None = _UNSET,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Patch any subset of mutable fields. Pass ``_UNSET`` to leave alone.

    ``expires_at`` accepts an explicit ``None`` meaning "never expires".
    """
    row = await _load(db, key_pk)
    fields_changed: list[str] = []

    if note is not _UNSET:
        row.note = note
        fields_changed.append("note")

    if scopes is not _UNSET:
        if scopes is None:
            raise ServiceError(
                "invalid_scopes",
                code=4001,
                http_status=400,
                detail={"valid": sorted(VALID_SCOPES)},
            )
        normalised = _validate_scopes(scopes)
        row.scopes = ",".join(normalised)
        fields_changed.append("scopes")

    if quota_daily_bytes is not _UNSET:
        if quota_daily_bytes is None or quota_daily_bytes < 0:
            raise ServiceError(
                "invalid_quota",
                code=4001,
                http_status=400,
                detail={"field": "quota_daily_bytes", "min": 0},
            )
        row.quota_daily_bytes = quota_daily_bytes
        fields_changed.append("quota_daily_bytes")

    if quota_per_minute is not _UNSET:
        if quota_per_minute is None or quota_per_minute < 1:
            raise ServiceError(
                "invalid_quota",
                code=4001,
                http_status=400,
                detail={"field": "quota_per_minute", "min": 1},
            )
        row.quota_per_minute = quota_per_minute
        fields_changed.append("quota_per_minute")

    if max_file_size is not _UNSET:
        if max_file_size is None or max_file_size < 1:
            raise ServiceError(
                "invalid_quota",
                code=4001,
                http_status=400,
                detail={"field": "max_file_size", "min": 1},
            )
        row.max_file_size = max_file_size
        fields_changed.append("max_file_size")

    if expires_at is not _UNSET:
        # ``None`` here means "no expiry"; a datetime sets a new deadline.
        row.expires_at = expires_at
        fields_changed.append("expires_at")

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        extra={
            "event": "admin.api_key.update",
            "key_id": row.key_id,
            "fields_changed": fields_changed,
        },
    )
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


async def revoke_api_key(
    db: AsyncSession,
    *,
    key_pk: int,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Mark a key revoked. Idempotency-violation: raises 409 on double revoke."""
    row = await _load(db, key_pk)
    if row.revoked_at is not None:
        raise ServiceError(
            "already_revoked",
            code=4002,
            http_status=409,
            detail={"id": key_pk, "key_id": row.key_id},
        )
    row.revoked_at = datetime.now(UTC)

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        extra={"event": "admin.api_key.revoke", "key_id": row.key_id},
    )
    await db.commit()
    await db.refresh(row)
    return _serialize(row)


async def get_api_key_usage(
    db: AsyncSession,
    *,
    key_pk: int,
    days: int = 30,
) -> dict[str, Any]:
    """Return a contiguous ``days``-wide window of daily usage rollups."""
    row = await _load(db, key_pk)

    today = datetime.now(UTC).date()
    start = today - timedelta(days=days - 1)  # inclusive window of ``days`` entries

    stmt = (
        select(ApiKeyUsage)
        .where(ApiKeyUsage.api_key_id == key_pk)
        .where(ApiKeyUsage.date >= start)
        .order_by(ApiKeyUsage.date.asc())
    )
    res = await db.execute(stmt)
    by_date: dict[date, ApiKeyUsage] = {u.date: u for u in res.scalars().all()}

    series: list[dict[str, Any]] = []
    total_bytes = 0
    total_calls = 0
    for i in range(days):
        d = start + timedelta(days=i)
        u = by_date.get(d)
        b = int(u.total_bytes) if u else 0
        c = int(u.total_calls) if u else 0
        total_bytes += b
        total_calls += c
        series.append({"date": d.isoformat(), "total_bytes": b, "total_calls": c})

    # ``func`` import retained for forward compatibility with a future
    # single-query SUM rollup; we currently aggregate in Python because
    # the window is small (≤ 365 days).
    _ = func
    return {
        "key_id": row.key_id,
        "days": series,
        "totals": {"total_bytes": total_bytes, "total_calls": total_calls},
    }
