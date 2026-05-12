"""Admin-tunable upload limits.

Stores three byte-size knobs + a chunked-upload kill switch as JSON values in
``settings_kv``. Reads fall back to safe defaults so unconfigured deployments
behave exactly like the legacy hard-coded constants.

Keys:
    share.simple_upload_max_bytes  — single-shot ``POST /api/share/file`` cap
                                     (default 10 MiB)
    share.chunk_upload_max_bytes   — chunked-upload total-bytes cap
                                     (default 10 GiB)
    share.multi_total_max_bytes    — multi-file share aggregate cap
                                     (default 10 GiB)
    share.chunk_upload_enabled     — kill switch for the chunked-upload flow
                                     (default True)
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.settings_kv import SettingsKV

# settings_kv keys we own here.
SIMPLE_KEY = "share.simple_upload_max_bytes"
CHUNK_KEY = "share.chunk_upload_max_bytes"
MULTI_KEY = "share.multi_total_max_bytes"
CHUNK_ENABLED_KEY = "share.chunk_upload_enabled"

UPLOAD_KEYS = (SIMPLE_KEY, CHUNK_KEY, MULTI_KEY, CHUNK_ENABLED_KEY)

# Defaults — kept aligned with the historic hard-coded values.
DEFAULT_SIMPLE = 10 * 1024 * 1024  # 10 MiB
DEFAULT_CHUNK = 10 * 1024 * 1024 * 1024  # 10 GiB
DEFAULT_MULTI = 10 * 1024 * 1024 * 1024  # 10 GiB
DEFAULT_CHUNK_ENABLED = True


def _coerce_int(v: Any, default: int) -> int:
    """Coerce a stored JSON value into a positive int, with a fallback."""
    if v is None:
        return default
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return n if n > 0 else default


def _coerce_bool(v: Any, default: bool) -> bool:
    """Coerce a stored JSON value into a bool, with a fallback."""
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes", "on"}
    return default


async def resolve_upload_limits(db: AsyncSession) -> dict[str, Any]:
    """Return the active upload limits, falling back to defaults per key."""
    res = await db.execute(
        select(SettingsKV).where(SettingsKV.key.in_(list(UPLOAD_KEYS)))
    )
    raw: dict[str, Any] = {row.key: row.value for row in res.scalars()}
    return {
        "simple_upload_max_bytes": _coerce_int(raw.get(SIMPLE_KEY), DEFAULT_SIMPLE),
        "chunk_upload_max_bytes": _coerce_int(raw.get(CHUNK_KEY), DEFAULT_CHUNK),
        "multi_total_max_bytes": _coerce_int(raw.get(MULTI_KEY), DEFAULT_MULTI),
        "chunk_upload_enabled": _coerce_bool(
            raw.get(CHUNK_ENABLED_KEY), DEFAULT_CHUNK_ENABLED
        ),
    }


async def save_upload_limits(
    db: AsyncSession,
    *,
    simple_upload_max_bytes: int | None = None,
    chunk_upload_max_bytes: int | None = None,
    multi_total_max_bytes: int | None = None,
    chunk_upload_enabled: bool | None = None,
) -> dict[str, Any]:
    """Upsert any of the four knobs (each optional). Returns the merged view."""

    async def _set(key: str, value: Any) -> None:
        row = await db.get(SettingsKV, key)
        if row is None:
            db.add(SettingsKV(key=key, value=value))
        else:
            row.value = value

    if simple_upload_max_bytes is not None:
        await _set(SIMPLE_KEY, _coerce_int(simple_upload_max_bytes, DEFAULT_SIMPLE))
    if chunk_upload_max_bytes is not None:
        await _set(CHUNK_KEY, _coerce_int(chunk_upload_max_bytes, DEFAULT_CHUNK))
    if multi_total_max_bytes is not None:
        await _set(MULTI_KEY, _coerce_int(multi_total_max_bytes, DEFAULT_MULTI))
    if chunk_upload_enabled is not None:
        await _set(CHUNK_ENABLED_KEY, bool(chunk_upload_enabled))

    await db.commit()
    return await resolve_upload_limits(db)


__all__ = [
    "UPLOAD_KEYS",
    "SIMPLE_KEY",
    "CHUNK_KEY",
    "MULTI_KEY",
    "CHUNK_ENABLED_KEY",
    "DEFAULT_SIMPLE",
    "DEFAULT_CHUNK",
    "DEFAULT_MULTI",
    "DEFAULT_CHUNK_ENABLED",
    "resolve_upload_limits",
    "save_upload_limits",
]
