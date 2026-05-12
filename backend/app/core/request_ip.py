"""Parse the requesting client IP, honouring an admin-controlled audit toggle.

Rules:
* If ``X-Forwarded-For`` is present, walk it right-to-left and return the
  first entry that parses as a valid IPv4/IPv6 address. Cloudflare's
  orange-cloud appends its own edge IP at the end, so picking the
  rightmost-compliant value gives us the closest hop we can trust.
* If no XFF header (or every candidate fails to parse), fall back to
  ``request.client.host``.
* If the admin has set ``settings_kv['audit.log_access_ip'] = false``, return
  ``None`` instead of the parsed IP. The AccessLog row is still written
  elsewhere — only the IP field is suppressed.

The audit toggle is read through a small async DB call. We accept a session
when one is already in hand; otherwise the caller opts in to the cached
synchronous behaviour by passing ``allow_ip=True``.
"""
from __future__ import annotations

import ipaddress

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.settings_kv import SettingsKV

AUDIT_IP_KEY = "audit.log_access_ip"


def _parse_xff(raw: str) -> str | None:
    """Return the rightmost valid IP in a comma-separated XFF header, or None."""
    for candidate in reversed([c.strip() for c in raw.split(",")]):
        if not candidate:
            continue
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            continue
    return None


def _raw_client_ip(request: Request) -> str | None:
    """Return the rightmost-compliant XFF IP, or request.client.host as fallback."""
    raw = request.headers.get("X-Forwarded-For")
    if raw:
        parsed = _parse_xff(raw)
        if parsed:
            return parsed
    return request.client.host if request.client else None


async def _audit_toggle_enabled(db: AsyncSession) -> bool:
    """Return the current value of the audit-IP toggle (default True)."""
    row = await db.get(SettingsKV, AUDIT_IP_KEY)
    if row is None or row.value is None:
        return True
    return bool(row.value)


async def client_ip(request: Request, db: AsyncSession) -> str | None:
    """Return the client IP, suppressed to ``None`` when audit toggle is off."""
    ip = _raw_client_ip(request)
    if ip is None:
        return None
    if not await _audit_toggle_enabled(db):
        return None
    return ip


__all__ = [
    "client_ip",
    "_parse_xff",
    "_raw_client_ip",
    "AUDIT_IP_KEY",
]
