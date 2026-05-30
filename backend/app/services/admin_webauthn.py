"""Admin WebAuthn (passkey) service.

Owns:
    * Settings (``settings_kv``) for RP ID / RP name / allowed origins and the
      ``password_login_enabled`` toggle.
    * Begin/complete primitives for both registration and authentication —
      these call into the ``webauthn`` PyPI package and own the per-flow
      challenge cookie (5-minute HMAC-signed value over ``settings.jwt_secret``).
    * CRUD for the ``webauthn_credentials`` rows.

The routes in :mod:`app.api.admin_auth` are thin wrappers around these
functions plus the cookie I/O.

RP ID derivation: if the admin hasn't set ``webauthn.rp_id``, we take the
request ``Host`` header's bare hostname (port stripped). Allowed origins:
default to ``[settings.app_url]``. Both are documented in the Settings UI.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..models.settings_kv import SettingsKV
from ..models.webauthn_credential import WebauthnCredential

# ── settings_kv keys ────────────────────────────────────────────────────────

RP_ID_KEY = "webauthn.rp_id"
RP_NAME_KEY = "webauthn.rp_name"
ALLOWED_ORIGINS_KEY = "webauthn.allowed_origins"
PASSWORD_LOGIN_ENABLED_KEY = "password_login_enabled"

# Default admin "user" identity inside the WebAuthn flow. Single-admin model
# means a stable string here is fine — the authenticator only sees it as the
# account label in OS-level UI.
ADMIN_USER_NAME = "admin"
ADMIN_USER_HANDLE = b"yui-drop-admin"


# ── settings_kv helpers ─────────────────────────────────────────────────────


async def _kv_get(db: AsyncSession, key: str) -> Any:
    row = await db.get(SettingsKV, key)
    return row.value if row is not None else None


async def _kv_set(db: AsyncSession, key: str, value: Any) -> None:
    row = await db.get(SettingsKV, key)
    if row is None:
        db.add(SettingsKV(key=key, value=value))
    else:
        row.value = value


def _coerce_bool(v: Any, default: bool) -> bool:
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes", "on"}
    return default


# ── Public helpers (also imported by app.api.admin for the password gate) ──


async def is_password_login_enabled(db: AsyncSession) -> bool:
    """Return whether ``POST /api/admin/login`` should accept passwords.

    Defaults to ``True`` if the row has never been written. Tolerant of the
    settings_kv row carrying ``True``/``"true"``/``1`` to ease manual edits.
    """
    raw = await _kv_get(db, PASSWORD_LOGIN_ENABLED_KEY)
    return _coerce_bool(raw, default=True)


async def set_password_login_enabled(db: AsyncSession, enabled: bool) -> bool:
    await _kv_set(db, PASSWORD_LOGIN_ENABLED_KEY, bool(enabled))
    await db.commit()
    return bool(enabled)


# ── RP / origin derivation ──────────────────────────────────────────────────


def derive_rp_id(request: Request, configured: str | None) -> str:
    """Bare hostname of the RP. Strips the port from the request Host header."""
    if configured:
        return configured.strip()
    host = request.url.hostname or "localhost"
    return host


def derive_origin(request: Request) -> str:
    """Single-origin string in the form ``scheme://host[:port]``."""
    return f"{request.url.scheme}://{request.url.netloc}"


async def resolve_allowed_origins(db: AsyncSession, request: Request) -> list[str]:
    """Configured allowed origins, falling back to ``[derive_origin(...)]``."""
    raw = await _kv_get(db, ALLOWED_ORIGINS_KEY)
    if isinstance(raw, list) and raw:
        return [str(o) for o in raw if o]
    if isinstance(raw, str) and raw.strip():
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [derive_origin(request), settings.app_url]


async def resolve_rp_name(db: AsyncSession) -> str:
    raw = await _kv_get(db, RP_NAME_KEY)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return settings.app_name


async def resolve_rp_id(db: AsyncSession, request: Request) -> str:
    raw = await _kv_get(db, RP_ID_KEY)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return derive_rp_id(request, None)


# ── Challenge cookie (HMAC-signed, 5-minute TTL) ────────────────────────────

CHALLENGE_TTL_SECONDS = 300
REGISTER_COOKIE_NAME = "yd_webauthn_reg"
LOGIN_COOKIE_NAME = "yd_webauthn_auth"


def _b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    padded = s + "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def sign_challenge_cookie(payload: dict[str, Any]) -> str:
    """Encode ``payload`` as base64url(JSON).base64url(HMAC-SHA256(JSON))."""
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    sig = hmac.new(settings.jwt_secret.encode(), body, hashlib.sha256).digest()
    return f"{_b64u_encode(body)}.{_b64u_encode(sig)}"


def verify_challenge_cookie(value: str | None) -> dict[str, Any] | None:
    """Inverse of :func:`sign_challenge_cookie`. Returns ``None`` on failure."""
    if not value or "." not in value:
        return None
    body_b64, sig_b64 = value.split(".", 1)
    try:
        body = _b64u_decode(body_b64)
        sig = _b64u_decode(sig_b64)
    except Exception:
        return None
    expected = hmac.new(settings.jwt_secret.encode(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(body)
    except Exception:
        return None
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        return None
    return payload


# ── Credential CRUD ─────────────────────────────────────────────────────────


async def count_credentials(db: AsyncSession) -> int:
    """Return number of registered passkeys. Returns 0 if the table is missing.

    The methods-probe endpoint (owned by Worker B) relies on this — callers
    should treat a missing table the same as zero credentials so a fresh
    deploy can still serve the login page before migrations run.
    """
    try:
        res = await db.execute(select(WebauthnCredential.id))
        return len(res.scalars().all())
    except (OperationalError, ProgrammingError):
        return 0


async def list_credentials(db: AsyncSession) -> list[WebauthnCredential]:
    res = await db.execute(select(WebauthnCredential).order_by(WebauthnCredential.created_at.desc()))
    return list(res.scalars().all())


async def get_credential(db: AsyncSession, cred_pk: int) -> WebauthnCredential | None:
    return await db.get(WebauthnCredential, cred_pk)


async def get_credential_by_credential_id(
    db: AsyncSession, credential_id: bytes
) -> WebauthnCredential | None:
    res = await db.execute(
        select(WebauthnCredential).where(WebauthnCredential.credential_id == credential_id)
    )
    return res.scalars().first()


async def insert_credential(
    db: AsyncSession,
    *,
    credential_id: bytes,
    public_key: bytes,
    sign_count: int,
    transports: list[str] | None,
    aaguid: bytes | None,
    label: str | None,
) -> WebauthnCredential:
    row = WebauthnCredential(
        credential_id=credential_id,
        public_key=public_key,
        sign_count=int(sign_count or 0),
        transports=",".join(transports) if transports else None,
        aaguid=aaguid,
        label=(label or None),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_credential_label(
    db: AsyncSession, cred_pk: int, label: str | None
) -> WebauthnCredential | None:
    row = await db.get(WebauthnCredential, cred_pk)
    if row is None:
        return None
    row.label = label or None
    await db.commit()
    await db.refresh(row)
    return row


async def delete_credential(db: AsyncSession, cred_pk: int) -> bool:
    row = await db.get(WebauthnCredential, cred_pk)
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def bump_credential_usage(db: AsyncSession, cred_pk: int, *, new_sign_count: int) -> None:
    row = await db.get(WebauthnCredential, cred_pk)
    if row is None:
        return
    row.sign_count = int(new_sign_count or 0)
    row.last_used_at = datetime.now(tz=UTC)
    await db.commit()


def credential_to_dict(row: WebauthnCredential) -> dict[str, Any]:
    return {
        "id": row.id,
        "label": row.label,
        "transports": [t for t in (row.transports or "").split(",") if t],
        "created_at": row.created_at,
        "last_used_at": row.last_used_at,
        "sign_count": row.sign_count,
    }


__all__ = [
    "ADMIN_USER_NAME",
    "ADMIN_USER_HANDLE",
    "ALLOWED_ORIGINS_KEY",
    "CHALLENGE_TTL_SECONDS",
    "LOGIN_COOKIE_NAME",
    "PASSWORD_LOGIN_ENABLED_KEY",
    "REGISTER_COOKIE_NAME",
    "RP_ID_KEY",
    "RP_NAME_KEY",
    "bump_credential_usage",
    "count_credentials",
    "credential_to_dict",
    "delete_credential",
    "derive_origin",
    "derive_rp_id",
    "get_credential",
    "get_credential_by_credential_id",
    "insert_credential",
    "is_password_login_enabled",
    "list_credentials",
    "resolve_allowed_origins",
    "resolve_rp_id",
    "resolve_rp_name",
    "set_password_login_enabled",
    "sign_challenge_cookie",
    "update_credential_label",
    "verify_challenge_cookie",
]
