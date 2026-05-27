"""Bearer API-key authentication for /api/v1 endpoints.

Security model
--------------
* Keys are issued in plaintext exactly once at admin-creation time, in the
  form ``yd_<key_id>_<secret>``. Only the 8-char public ``key_id`` prefix and
  a bcrypt hash of the FULL plaintext are persisted.
* On every request we look up the row by ``key_id`` (cheap, indexed) and
  then bcrypt-verify the supplied plaintext against ``key_hash``. bcrypt's
  internal comparison is constant-time, so we don't leak per-byte timing.
* Lookup failure and hash mismatch both return the same opaque
  ``invalid_key`` error so an attacker cannot enumerate which prefixes exist.
* Scope is checked AFTER authentication so we never reveal that a particular
  key exists by upgrading a 401 to a 403 differently than for unknown keys.
* The plaintext is never logged — only ``key_id`` ever appears in audit /
  structured logs.
"""
from __future__ import annotations

import re
import secrets
import string
from datetime import UTC, datetime
from typing import Annotated

import bcrypt
import structlog
from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.session import get_db
from ..models.api_key import ApiKey

log = structlog.get_logger(__name__)

# yd_<8 lowercase alnum>_<secret>
_KEY_ID_ALPHABET = string.ascii_lowercase + string.digits
_KEY_FORMAT_RE = re.compile(r"^yd_([a-z0-9]{8})_([A-Za-z0-9_\-]{16,})$")


def generate_api_key() -> tuple[str, str, str]:
    """Mint a brand-new API key.

    Returns ``(plaintext_full, key_id, key_hash)``.

    * ``plaintext_full`` — what we hand to the admin exactly once, never stored.
    * ``key_id`` — 8 lowercase alphanumeric chars used as the public lookup prefix.
    * ``key_hash`` — bcrypt hash of ``plaintext_full`` for persistence.
    """
    key_id = "".join(secrets.choice(_KEY_ID_ALPHABET) for _ in range(8))
    # token_urlsafe(24) returns ~32 chars in [A-Za-z0-9_-]. Strip any
    # accidental padding characters just in case (token_urlsafe shouldn't
    # emit ``=`` but be defensive).
    secret = secrets.token_urlsafe(24).rstrip("=")[:32]
    # Guarantee a stable length even if token_urlsafe under-produced (very
    # unlikely with 24 random bytes, but cheap to enforce).
    while len(secret) < 32:
        secret += secrets.choice(string.ascii_letters + string.digits)
    secret = secret[:32]

    plaintext_full = f"yd_{key_id}_{secret}"
    key_hash = bcrypt.hashpw(plaintext_full.encode(), bcrypt.gensalt()).decode()
    return plaintext_full, key_id, key_hash


def verify_password(plaintext: str, hashed: str) -> bool:
    """Bcrypt-verify ``plaintext`` against ``hashed``. Never raises."""
    try:
        return bcrypt.checkpw(plaintext.encode(), hashed.encode())
    except Exception:
        return False


def parse_bearer(authorization: str | None) -> str:
    """Extract the token from a ``Authorization: Bearer <token>`` header.

    Raises 401 ``missing_bearer`` if the header is missing or malformed.
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail={"code": 4011, "message": "missing_bearer", "detail": None},
        )
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=401,
            detail={"code": 4011, "message": "missing_bearer", "detail": None},
        )
    return parts[1].strip()


def extract_key_id(plaintext: str) -> str | None:
    """Return the 8-char ``key_id`` from a ``yd_<id>_<secret>`` plaintext, or None."""
    m = _KEY_FORMAT_RE.match(plaintext or "")
    if not m:
        return None
    return m.group(1)


def require_api_key(scope: str):
    """Return a FastAPI dependency that enforces a Bearer API key with ``scope``.

    Order of checks:

    1. Parse ``Authorization`` header.
    2. Validate key plaintext shape.
    3. Look up active row by ``key_id``.
    4. bcrypt-verify plaintext against ``key_hash``.
    5. Confirm row is not revoked / expired.
    6. Confirm the requested scope is in ``scopes_list()``.
    7. Best-effort update ``last_used_at``.
    8. Stash on ``request.state.api_key`` and return the row.
    """

    async def _dep(
        request: Request,
        db: Annotated[AsyncSession, Depends(get_db)],
        authorization: Annotated[str | None, Header()] = None,
    ) -> ApiKey:
        plaintext = parse_bearer(authorization)

        key_id = extract_key_id(plaintext)
        if key_id is None:
            raise HTTPException(
                status_code=401,
                detail={"code": 4011, "message": "invalid_key_format", "detail": None},
            )

        row = (
            await db.execute(
                select(ApiKey).where(
                    ApiKey.key_id == key_id,
                    ApiKey.revoked_at.is_(None),
                )
            )
        ).scalars().first()
        if row is None:
            raise HTTPException(
                status_code=401,
                detail={"code": 4011, "message": "invalid_key", "detail": None},
            )

        if not verify_password(plaintext, row.key_hash):
            # Identical envelope to the lookup miss above — no enumeration.
            raise HTTPException(
                status_code=401,
                detail={"code": 4011, "message": "invalid_key", "detail": None},
            )

        now = datetime.now(UTC)
        if not row.is_active(now=now):
            raise HTTPException(
                status_code=401,
                detail={
                    "code": 4012,
                    "message": "key_revoked_or_expired",
                    "detail": None,
                },
            )

        if scope not in row.scopes_list():
            raise HTTPException(
                status_code=403,
                detail={
                    "code": 4031,
                    "message": "scope_denied",
                    "detail": {"required": scope},
                },
            )

        # Best-effort last_used_at bump. We swallow any commit error so the
        # request itself succeeds even if a concurrent transaction races us.
        try:
            await db.execute(
                update(ApiKey).where(ApiKey.id == row.id).values(last_used_at=now)
            )
            await db.commit()
        except Exception:  # noqa: BLE001 — explicitly non-fatal
            log.warning("api_auth.last_used_update_failed", key_id=row.key_id)

        request.state.api_key = row
        return row

    return _dep
