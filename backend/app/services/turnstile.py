"""Cloudflare Turnstile verification.

Tiny wrapper around the ``siteverify`` endpoint. Returns ``True`` when
verification succeeds OR when Turnstile is not configured (so test/dev
deployments don't require a real secret). The runtime ``turnstile_enabled``
flag (settings_kv) is checked by the caller — this module never reads the DB
for the flag, but does fall back to the DB-resolved ``secret_key`` when one
has been configured via the admin UI.
"""
from __future__ import annotations

import httpx

from ..core.config import settings
from ..core.logging import get_logger

_log = get_logger(__name__)

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def _resolve_secret(db: object | None) -> str:
    """Best-effort lookup for the live secret.

    Prefers ``settings_kv`` (admin-configured, AES-GCM at rest); falls back
    to the env-provided value. ``db`` is typed loosely so callers without an
    AsyncSession in scope can still invoke us — we just skip the DB lookup.
    """
    if db is None:
        return settings.turnstile_secret_key or ""
    try:
        from .admin_turnstile import resolve_turnstile_config

        cfg = await resolve_turnstile_config(db)  # type: ignore[arg-type]
        return cfg.get("secret_key") or settings.turnstile_secret_key or ""
    except Exception:
        return settings.turnstile_secret_key or ""


async def verify_turnstile(
    token: str,
    remote_ip: str | None = None,
    *,
    db: object | None = None,
) -> bool:
    """Verify a Turnstile ``cf-turnstile-response`` token.

    Returns ``True`` if Cloudflare reports ``success=true``, or if the server
    has no secret configured (skip mode). Network errors are treated as
    verification failures. Pass ``db`` to honour the admin-configured secret
    saved in ``settings_kv``; without it we only consult the env fallback.
    """
    secret = await _resolve_secret(db)
    if not secret:
        return True  # not configured → skip
    if not token:
        return False
    data: dict[str, str] = {
        "secret": secret,
        "response": token,
    }
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(SITEVERIFY_URL, data=data)
            payload = r.json()
    except Exception:
        _log.warning("turnstile.verify.network_error")
        return False
    if not isinstance(payload, dict):
        return False
    return bool(payload.get("success", False))
