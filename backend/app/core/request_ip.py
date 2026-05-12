"""Parse the requesting client IP, honouring an admin-controlled audit toggle.

Rules:
* If the ``CF-Connecting-IP`` header is present and parses as a valid
  IPv4/IPv6 address, return it. Cloudflare populates this header with the
  original visitor IP on every request that traverses the orange cloud,
  and unlike ``X-Forwarded-For`` it is not appended-to by intermediate
  proxies — so it survives any number of nginx hops without further
  walking.
* Otherwise, if ``X-Forwarded-For`` is present, walk it left-to-right and
  return the first entry that parses as a valid address. The leftmost
  value is the address closest to the original client; later entries
  are proxy hops added by each layer (CF edge → our nginx → docker), so
  picking the rightmost would systematically pick the closest proxy
  rather than the visitor.
* If neither header yields a usable value, fall back to
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
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.settings_kv import SettingsKV

# Canonical settings_kv key for the "record IP on access_logs" toggle.
# Treat this constant as the single source of truth — every reader and
# writer in the codebase must import it from here rather than hardcoding
# the string. The historical bug this constant guards against is having
# the PATCH endpoint write a different key (``audit_log_access_ip``) than
# the readers query (``audit.log_access_ip``), which silently dropped
# the toggle. See ``patch_admin_settings`` for the request-time key
# translation that keeps the public API friendly while preserving the
# dotted internal layout.
AUDIT_IP_KEY = "audit.log_access_ip"


def coerce_bool(value: Any, *, default: bool = True) -> bool:
    """Coerce a settings_kv value into a strict boolean.

    Accepts:
        * actual ``bool`` — returned as-is.
        * ``str`` — case-insensitive ``"true"``/``"false"``/``"1"``/``"0"``;
          ``"yes"``/``"no"``/``"on"``/``"off"`` are also recognised for
          forward compatibility with hand-edited rows.
        * ``int`` — non-zero ⇒ ``True``, zero ⇒ ``False``.
        * ``None`` — ``default``.

    Anything else falls back to ``default``.

    This function exists because ``settings_kv.value`` is a JSON column:
    most rows round-trip as native Python booleans, but a string
    ``"false"`` is truthy under ``bool()``, so naive coercion would
    silently invert the toggle. Callers should funnel every read of a
    boolean settings row through this helper.
    """
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        norm = value.strip().lower()
        if norm in {"true", "1", "yes", "on"}:
            return True
        if norm in {"false", "0", "no", "off", ""}:
            return False
    return default


def _parse_xff(raw: str) -> str | None:
    """Return the leftmost valid IP in a comma-separated XFF header, or None.

    The leftmost value is the address closest to the original client.
    Each proxy hop on the request path appends its own perceived peer
    address to the right, so walking left-to-right and returning the
    first parseable entry skips garbage tokens while still surfacing
    the visitor IP rather than a downstream proxy hop.
    """
    for candidate in [c.strip() for c in raw.split(",")]:
        if not candidate:
            continue
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            continue
    return None


def _parse_single_ip(raw: str) -> str | None:
    """Return ``raw`` stripped if it parses as a valid IP, else ``None``."""
    candidate = raw.strip()
    if not candidate:
        return None
    try:
        ipaddress.ip_address(candidate)
        return candidate
    except ValueError:
        return None


def _raw_client_ip(request: Request) -> str | None:
    """Resolve the originating client IP from headers, with CF preference.

    Resolution order:
        1. ``CF-Connecting-IP`` — Cloudflare's single-value visitor header.
        2. Leftmost valid entry in ``X-Forwarded-For``.
        3. ``request.client.host``.
    """
    cf = request.headers.get("CF-Connecting-IP")
    if cf:
        parsed = _parse_single_ip(cf)
        if parsed:
            return parsed
    raw = request.headers.get("X-Forwarded-For")
    if raw:
        parsed = _parse_xff(raw)
        if parsed:
            return parsed
    return request.client.host if request.client else None


async def _audit_toggle_enabled(db: AsyncSession) -> bool:
    """Return the current value of the audit-IP toggle (default True).

    Funnels the raw settings_kv value through :func:`coerce_bool` so that
    any historical representation (Python ``bool``, the strings
    ``"true"``/``"false"``, the ints ``0``/``1``) is interpreted
    correctly. A missing row defaults to ``True`` — the audit log is
    on by default to preserve forensic capability.
    """
    row = await db.get(SettingsKV, AUDIT_IP_KEY)
    if row is None:
        return True
    return coerce_bool(row.value, default=True)


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
    "coerce_bool",
    "_parse_xff",
    "_parse_single_ip",
    "_raw_client_ip",
    "_audit_toggle_enabled",
    "AUDIT_IP_KEY",
]
