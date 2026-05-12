"""Admin-tunable Cloudflare Turnstile configuration.

Mirrors the pattern used by :mod:`app.services.admin_storage`: site key + the
``enabled`` flag are stored as plain JSON, and ``secret_key`` is AES-GCM
encrypted (via :mod:`app.core.crypto`) before it lands in ``settings_kv``.
Reads always mask the secret on the wire — plaintext only ever returns to the
verifier via :func:`resolve_turnstile_config`.

Keys:
    turnstile_enabled         — bool (existing row, retained for compatibility)
    turnstile_site_key        — str, plaintext
    turnstile_secret_key_enc  — str, AES-GCM ciphertext (base64url)
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.crypto import decrypt_secret, encrypt_secret
from ..models.settings_kv import SettingsKV

ENABLED_KEY = "turnstile_enabled"
SITE_KEY = "turnstile_site_key"
SECRET_KEY_ENC = "turnstile_secret_key_enc"

TURNSTILE_KEYS = (ENABLED_KEY, SITE_KEY, SECRET_KEY_ENC)

MASK = "****"


def _coerce_bool(v: Any, default: bool = False) -> bool:
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes", "on"}
    return default


async def _kv_get_one(db: AsyncSession, key: str) -> Any:
    row = await db.get(SettingsKV, key)
    return row.value if row is not None else None


async def _kv_set_one(db: AsyncSession, key: str, value: Any) -> None:
    row = await db.get(SettingsKV, key)
    if row is None:
        db.add(SettingsKV(key=key, value=value))
    else:
        row.value = value


async def read_turnstile_config(db: AsyncSession) -> dict[str, Any]:
    """Return the admin-visible Turnstile config (secret masked).

    Falls back to the env-provided ``settings.turnstile_*`` values when the
    settings_kv rows are absent, so first-boot deployments configured via the
    legacy env keys still appear configured in the admin UI.
    """
    res = await db.execute(
        select(SettingsKV).where(SettingsKV.key.in_(list(TURNSTILE_KEYS)))
    )
    raw: dict[str, Any] = {row.key: row.value for row in res.scalars()}

    site_key = raw.get(SITE_KEY)
    if not isinstance(site_key, str) or not site_key:
        site_key = settings.turnstile_site_key or ""

    has_secret = bool(raw.get(SECRET_KEY_ENC)) or bool(settings.turnstile_secret_key)
    enabled = _coerce_bool(raw.get(ENABLED_KEY), default=False)

    return {
        "enabled": enabled,
        "site_key": site_key,
        "secret_key": MASK if has_secret else "",
        "has_secret": has_secret,
    }


async def resolve_turnstile_config(db: AsyncSession) -> dict[str, Any]:
    """Return the live config (secret in plaintext) for the verifier.

    Resolution order for the secret:
        1. ``settings_kv['turnstile_secret_key_enc']`` decrypted
        2. ``settings.turnstile_secret_key`` env fallback

    Resolution order for the site key:
        1. ``settings_kv['turnstile_site_key']``
        2. ``settings.turnstile_site_key``
    """
    res = await db.execute(
        select(SettingsKV).where(SettingsKV.key.in_(list(TURNSTILE_KEYS)))
    )
    raw: dict[str, Any] = {row.key: row.value for row in res.scalars()}

    site_key = raw.get(SITE_KEY)
    if not isinstance(site_key, str) or not site_key:
        site_key = settings.turnstile_site_key or ""

    enc = raw.get(SECRET_KEY_ENC)
    secret_key = ""
    if isinstance(enc, str) and enc:
        try:
            secret_key = decrypt_secret(enc)
        except Exception:
            # Bad ciphertext / missing key → fall back to env value so we
            # don't silently disable bot protection on a partial config.
            secret_key = settings.turnstile_secret_key or ""
    else:
        secret_key = settings.turnstile_secret_key or ""

    enabled = _coerce_bool(raw.get(ENABLED_KEY), default=False)
    return {
        "enabled": enabled,
        "site_key": site_key,
        "secret_key": secret_key,
    }


async def save_turnstile_config(
    db: AsyncSession,
    *,
    enabled: bool | None = None,
    site_key: str | None = None,
    secret_key: str | None = None,
) -> dict[str, Any]:
    """Persist any subset of the three knobs.

    ``secret_key`` semantics:
        - ``None`` or empty string → keep the existing encrypted value.
        - non-empty string → AES-GCM encrypt and replace the stored value.

    If ``enabled=True`` is requested but no secret has ever been stored (and
    ``settings.turnstile_secret_key`` is also empty), the call refuses to
    enable — matching the existing behaviour of ``patch_admin_settings`` for
    the ``turnstile_enabled`` row.
    """
    if site_key is not None:
        await _kv_set_one(db, SITE_KEY, site_key.strip())

    if secret_key is not None and secret_key != "":
        await _kv_set_one(db, SECRET_KEY_ENC, encrypt_secret(secret_key))

    if enabled is not None:
        if enabled:
            # Refuse to enable without a usable secret + site key.
            current = await read_turnstile_config(db)
            if not current["site_key"] or not current["has_secret"]:
                # Recompute against the secret we might have just written.
                eff = await resolve_turnstile_config(db)
                if not eff["site_key"] or not eff["secret_key"]:
                    from .common import ServiceError

                    raise ServiceError(
                        "turnstile_keys_missing",
                        code=4004,
                        http_status=400,
                        detail={"need": ["turnstile_site_key", "turnstile_secret_key"]},
                    )
        await _kv_set_one(db, ENABLED_KEY, bool(enabled))

    await db.commit()
    return await read_turnstile_config(db)


__all__ = [
    "TURNSTILE_KEYS",
    "ENABLED_KEY",
    "SITE_KEY",
    "SECRET_KEY_ENC",
    "read_turnstile_config",
    "resolve_turnstile_config",
    "save_turnstile_config",
]
