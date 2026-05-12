"""Security primitives: JWT, bcrypt, pickup-code generation.

This module is dependency-free with respect to the database. Callers compose
these primitives with persistence (e.g. the share service decides whether a
generated pickup code is unique by querying the DB and asking for another one
on collision).
"""
from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from .config import settings

# ── Passwords ───────────────────────────────────────────────────────────────
#
# We use the ``bcrypt`` library directly. passlib's CryptContext is
# incompatible with bcrypt >= 5.x (it reads ``bcrypt.__about__`` which was
# removed). bcrypt accepts up to 72 bytes of password material; anything
# longer is silently truncated by pre-hashing with SHA-256 below so that
# arbitrarily long admin passwords still work safely.


def _prepare_password(plain: str) -> bytes:
    """Return at most 72 bytes of password material for bcrypt.

    bcrypt's max input is 72 bytes. Rather than truncate user input — which
    would silently weaken long passwords — we SHA-256 anything longer than
    72 bytes and use the digest. Constant-length input, no security loss.
    """
    import hashlib

    raw = plain.encode("utf-8")
    if len(raw) > 72:
        return hashlib.sha256(raw).digest()
    return raw


def hash_password(plain: str) -> str:
    """Hash a plaintext password using bcrypt (returned as utf-8 string)."""
    return bcrypt.hashpw(_prepare_password(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time compare. Returns False on any internal hashing error."""
    try:
        return bcrypt.checkpw(_prepare_password(plain), hashed.encode("utf-8"))
    except Exception:
        return False


# ── JWT (HS256 by default) ──────────────────────────────────────────────────


def encode_jwt(
    payload: dict[str, Any],
    *,
    expires_in: timedelta | None = None,
) -> str:
    """Encode a JWT signed with settings.jwt_secret using settings.jwt_algorithm.

    ``iat`` and ``exp`` are filled in automatically when not present in payload.
    ``expires_in`` overrides the default of ``settings.jwt_ttl_days``.
    """
    now = datetime.now(tz=UTC)
    ttl = expires_in or timedelta(days=settings.jwt_ttl_days)
    body: dict[str, Any] = {
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        **payload,
    }
    return jwt.encode(body, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict[str, Any]:
    """Decode/verify a JWT. Raises ``jwt.InvalidTokenError`` subclasses on bad input."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def issue_admin_token(subject: str = "admin") -> tuple[str, datetime]:
    """Convenience wrapper used by the admin login endpoint.

    Returns ``(token, expires_at_utc)``.
    """
    now = datetime.now(tz=UTC)
    exp = now + timedelta(days=settings.jwt_ttl_days)
    token = encode_jwt({"sub": subject, "role": "admin"}, expires_in=exp - now)
    return token, exp


# ── Pickup-code generation ──────────────────────────────────────────────────

# Patterns we reject regardless of length 5..8.
_KNOWN_BAD_LITERAL: frozenset[str] = frozenset(
    {
        # Strict ascending / descending of the canonical 0-9 alphabet
        "012345", "123456", "234567", "345678", "456789",
        "987654", "876543", "765432", "654321", "543210",
        "0123456", "1234567", "2345678", "3456789",
        "9876543", "8765432", "7654321", "6543210",
        "01234567", "12345678", "23456789",
        "98765432", "87654321", "76543210",
        # Repeating short blocks
        "123123", "121212", "112233", "111222",
        "1231231", "1212121",
        "12341234", "12121212", "11223344",
        # Other obvious bait
        "098765", "0987654", "00098765",
    }
)


def _is_low_entropy(code: str) -> bool:
    """Return True if ``code`` matches a guessable / low-entropy pattern.

    Rules (all length-agnostic):
      * all identical digits (e.g. 111111)
      * strict +1 monotone (e.g. 123456)
      * strict -1 monotone (e.g. 654321)
      * repeating 2-digit block (e.g. 121212 — but not 111111, handled above)
      * repeating 3-digit block (e.g. 123123)
      * any literal in ``_KNOWN_BAD_LITERAL``
    """
    if not code or not code.isdigit():
        return True
    if code in _KNOWN_BAD_LITERAL:
        return True
    # All identical (e.g. 111111).
    if len(set(code)) == 1:
        return True

    digits = [int(c) for c in code]
    # Strict ascending +1.
    if all(digits[i + 1] - digits[i] == 1 for i in range(len(digits) - 1)):
        return True
    # Strict descending -1.
    if all(digits[i] - digits[i + 1] == 1 for i in range(len(digits) - 1)):
        return True

    # Repeating 2-digit block like 121212 / 343434.
    if len(code) % 2 == 0:
        block = code[:2]
        if block * (len(code) // 2) == code and block[0] != block[1]:
            return True

    # Repeating 3-digit block like 123123 / 456456.
    if len(code) % 3 == 0 and len(code) >= 6:
        block = code[:3]
        if block * (len(code) // 3) == code:
            return True

    return False


def generate_pickup_code(length: int | None = None) -> str:
    """Produce one random N-digit pickup code that is NOT low-entropy.

    Default length is ``settings.pickup_code_length`` (typically 6).
    Collision against existing rows is the caller's responsibility — see
    ``generate_unique_pickup_code`` for an async helper that retries.
    """
    n = length if length is not None else settings.pickup_code_length
    if not 5 <= n <= 8:
        raise ValueError("pickup code length must be between 5 and 8")
    # Bounded retry — _is_low_entropy rejects a small fraction of the
    # 10**n space, so a handful of attempts is always enough in practice.
    for _ in range(64):
        cand = "".join(str(secrets.randbelow(10)) for _ in range(n))
        if not _is_low_entropy(cand):
            return cand
    # Should never happen for n >= 5.
    raise RuntimeError("Exhausted attempts generating a high-entropy pickup code")


async def generate_unique_pickup_code(
    exists_func,  # async def exists(code: str) -> bool
    length: int | None = None,
    max_attempts: int = 50,
) -> str:
    """Generate a unique, high-entropy pickup code.

    ``exists_func`` is awaited per candidate; it MUST return True if the
    candidate collides with an active (non-soft-deleted) row. Raises
    ``RuntimeError`` after ``max_attempts`` collisions.
    """
    for _ in range(max_attempts):
        cand = generate_pickup_code(length)
        if not await exists_func(cand):
            return cand
    raise RuntimeError(
        f"Could not generate a unique pickup code after {max_attempts} attempts"
    )
