"""Signed download tokens for ``/api/share/download/{code}[/{file_id}]``.

A token is minted whenever the server hands out a download URL — on pickup
(``POST /api/share/select``, ``POST /api/v1/pickup``) and in the owner's
``/api/v1/shares`` listing — and travels as the ``t`` query parameter::

    /api/share/download/<code>[/<file_id>]?t=<share_id>.<exp>.<mac>

* ``share_id`` — the ``filecodes.id`` the token is bound to. It is part of
  the token so the rate limiter can verify a token without a DB lookup.
* ``exp``      — unix expiry (``DOWNLOAD_TOKEN_TTL_MIN`` after minting).
* ``mac``      — truncated HMAC-SHA256 over ``(share_id, code, file_id, exp)``
  with a key derived from the server secret, base64url without padding.

Every field is in the URL-safe alphabet, so the token needs no escaping.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time

from .config import settings

_KEY_LABEL = b"download-token-v1"
_MAC_BYTES = 16
# Sanity bounds on the numeric fields so a hostile token can't make us parse
# an arbitrarily long integer.
_MAX_DIGITS = 12
# Indirection so tests can move the clock without patching ``time.time``
# for the whole process.
_clock = time.time


def _signing_key() -> bytes:
    secret = settings.jwt_secret or settings.secrets_key
    return hmac.new(secret.encode("utf-8"), _KEY_LABEL, hashlib.sha256).digest()


def _mac(share_id: int, code: str, file_id: int | None, exp: int) -> str:
    msg = f"{share_id}|{code}|{'' if file_id is None else file_id}|{exp}".encode()
    digest = hmac.new(_signing_key(), msg, hashlib.sha256).digest()[:_MAC_BYTES]
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def mint_download_token(
    share_id: int,
    code: str,
    file_id: int | None = None,
    *,
    now: float | None = None,
) -> str:
    """Return a token for one share (and one member file of a multi share)."""
    exp = int(now if now is not None else _clock()) + settings.download_token_ttl_min * 60
    return f"{share_id}.{exp}.{_mac(share_id, code, file_id, exp)}"


def verify_download_token(
    token: str,
    *,
    code: str,
    file_id: int | None,
    now: float | None = None,
) -> int | None:
    """Return the ``filecodes.id`` the token is bound to, or ``None``.

    ``None`` covers every failure (malformed, expired, wrong code / file,
    bad MAC) — callers never need to tell them apart.
    """
    parts = (token or "").split(".")
    if len(parts) != 3:
        return None
    sid, exp, mac = parts
    if not (sid.isdigit() and exp.isdigit()):
        return None
    if len(sid) > _MAX_DIGITS or len(exp) > _MAX_DIGITS:
        return None
    if int(exp) <= int(now if now is not None else _clock()):
        return None
    expected = _mac(int(sid), code, file_id, int(exp))
    if not hmac.compare_digest(expected, mac):
        return None
    return int(sid)


def signed_download_path(code: str, share_id: int, file_id: int | None = None) -> str:
    """Same-origin download path with a freshly minted ``t`` token."""
    path = f"/api/share/download/{code}"
    if file_id is not None:
        path += f"/{file_id}"
    return f"{path}?t={mint_download_token(share_id, code, file_id)}"


__all__ = [
    "mint_download_token",
    "verify_download_token",
    "signed_download_path",
]
