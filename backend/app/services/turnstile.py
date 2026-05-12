"""Cloudflare Turnstile verification.

Tiny wrapper around the ``siteverify`` endpoint. Returns ``True`` when
verification succeeds OR when Turnstile is not configured (so test/dev
deployments don't require a real secret). The runtime ``turnstile_enabled``
flag (settings_kv) is checked by the caller — this module never reads the DB.
"""
from __future__ import annotations

import httpx

from ..core.config import settings
from ..core.logging import get_logger

_log = get_logger(__name__)

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile(token: str, remote_ip: str | None = None) -> bool:
    """Verify a Turnstile ``cf-turnstile-response`` token.

    Returns ``True`` if Cloudflare reports ``success=true``, or if the server
    has no ``TURNSTILE_SECRET_KEY`` configured (skip mode). Network errors are
    treated as verification failures.
    """
    if not settings.turnstile_secret_key:
        return True  # not configured → skip
    if not token:
        return False
    data: dict[str, str] = {
        "secret": settings.turnstile_secret_key,
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
