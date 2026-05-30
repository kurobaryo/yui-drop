"""Admin OIDC configuration + OIDC primitives (discovery, JWKS, token verify).

This module mirrors the encrypt/mask pattern from
:mod:`app.services.admin_storage` for the OIDC ``client_secret``:

    * read paths return the secret as ``"****"`` (masked) — never plaintext.
    * write paths AES-GCM encrypt with :mod:`app.core.crypto` before persisting.
    * the dedicated :func:`resolve_oidc_config` helper returns the live config
      (secret decrypted) and is the ONLY way to obtain plaintext, used by the
      callback handler when exchanging the auth code for tokens.

The OIDC primitives at the bottom of the file (``fetch_discovery``,
``fetch_jwks``, ``verify_id_token``, ``exchange_code``) are dependency-light
wrappers over ``httpx`` + ``python-jose``. JWKS is cached in-process with a
1h TTL keyed by the ``jwks_uri`` so repeated callbacks don't hammer the IdP.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.crypto import decrypt_secret, encrypt_secret
from ..models.settings_kv import SettingsKV
from .common import ServiceError

# ── settings_kv keys ────────────────────────────────────────────────────────

ENABLED_KEY = "oidc.enabled"
ISSUER_KEY = "oidc.issuer"
CLIENT_ID_KEY = "oidc.client_id"
CLIENT_SECRET_ENC_KEY = "oidc.client_secret_enc"
SCOPES_KEY = "oidc.scopes"
REDIRECT_URI_KEY = "oidc.redirect_uri"
PROVIDER_LABEL_KEY = "oidc.provider_label"
ALLOW_SELF_BINDING_KEY = "oidc.allow_self_binding"

OIDC_KEYS = (
    ENABLED_KEY,
    ISSUER_KEY,
    CLIENT_ID_KEY,
    CLIENT_SECRET_ENC_KEY,
    SCOPES_KEY,
    REDIRECT_URI_KEY,
    PROVIDER_LABEL_KEY,
    ALLOW_SELF_BINDING_KEY,
)

MASK = "****"
DEFAULT_SCOPES = "openid profile email"
DEFAULT_PROVIDER_LABEL = "oidc"


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


def _derive_redirect_uri(explicit: str | None) -> str:
    """Fall back to ``app_url + /admin/oidc/callback`` when no override is set."""
    if explicit:
        return explicit
    base = (settings.app_url or "").rstrip("/")
    return f"{base}/admin/oidc/callback"


# ── CRUD ────────────────────────────────────────────────────────────────────


async def read_oidc_config(db: AsyncSession) -> dict[str, Any]:
    """Return the admin-visible OIDC config with the client_secret masked."""
    res = await db.execute(select(SettingsKV).where(SettingsKV.key.in_(list(OIDC_KEYS))))
    raw: dict[str, Any] = {row.key: row.value for row in res.scalars()}

    has_secret = bool(raw.get(CLIENT_SECRET_ENC_KEY))
    explicit_redirect = raw.get(REDIRECT_URI_KEY) or ""
    return {
        "enabled": _coerce_bool(raw.get(ENABLED_KEY), default=False),
        "issuer": raw.get(ISSUER_KEY) or "",
        "client_id": raw.get(CLIENT_ID_KEY) or "",
        "client_secret": MASK if has_secret else "",
        "has_secret": has_secret,
        "scopes": raw.get(SCOPES_KEY) or DEFAULT_SCOPES,
        "redirect_uri": explicit_redirect,
        "effective_redirect_uri": _derive_redirect_uri(
            explicit_redirect if isinstance(explicit_redirect, str) else None
        ),
        "provider_label": raw.get(PROVIDER_LABEL_KEY) or DEFAULT_PROVIDER_LABEL,
        "allow_self_binding": _coerce_bool(raw.get(ALLOW_SELF_BINDING_KEY), default=True),
    }


async def resolve_oidc_config(db: AsyncSession) -> dict[str, Any]:
    """Return the live OIDC config including the decrypted ``client_secret``.

    Only callers that actually need to hit the IdP (token exchange, etc.)
    should use this — never serialise the result back to a client.
    """
    res = await db.execute(select(SettingsKV).where(SettingsKV.key.in_(list(OIDC_KEYS))))
    raw: dict[str, Any] = {row.key: row.value for row in res.scalars()}

    secret = ""
    enc = raw.get(CLIENT_SECRET_ENC_KEY)
    if isinstance(enc, str) and enc:
        try:
            secret = decrypt_secret(enc)
        except Exception:
            secret = ""

    explicit_redirect = raw.get(REDIRECT_URI_KEY) or ""
    return {
        "enabled": _coerce_bool(raw.get(ENABLED_KEY), default=False),
        "issuer": raw.get(ISSUER_KEY) or "",
        "client_id": raw.get(CLIENT_ID_KEY) or "",
        "client_secret": secret,
        "scopes": raw.get(SCOPES_KEY) or DEFAULT_SCOPES,
        "redirect_uri": _derive_redirect_uri(
            explicit_redirect if isinstance(explicit_redirect, str) else None
        ),
        "provider_label": raw.get(PROVIDER_LABEL_KEY) or DEFAULT_PROVIDER_LABEL,
        "allow_self_binding": _coerce_bool(raw.get(ALLOW_SELF_BINDING_KEY), default=True),
    }


async def save_oidc_config(
    db: AsyncSession,
    *,
    enabled: bool | None = None,
    issuer: str | None = None,
    client_id: str | None = None,
    client_secret: str | None = None,
    scopes: str | None = None,
    redirect_uri: str | None = None,
    provider_label: str | None = None,
    allow_self_binding: bool | None = None,
) -> dict[str, Any]:
    """Persist any subset of the OIDC knobs.

    ``client_secret`` semantics:
        * ``None`` or empty string → keep the existing encrypted value.
        * non-empty string → AES-GCM encrypt and replace.

    ``enabled=True`` requires that ``issuer``, ``client_id``, AND a stored
    client secret are all present (either freshly supplied or previously
    saved). Otherwise the call is refused with ``oidc_config_incomplete``.
    """
    if issuer is not None:
        await _kv_set_one(db, ISSUER_KEY, issuer.strip())
    if client_id is not None:
        await _kv_set_one(db, CLIENT_ID_KEY, client_id.strip())
    if client_secret is not None and client_secret != "" and client_secret != MASK:
        await _kv_set_one(db, CLIENT_SECRET_ENC_KEY, encrypt_secret(client_secret))
    if scopes is not None:
        await _kv_set_one(db, SCOPES_KEY, scopes.strip() or DEFAULT_SCOPES)
    if redirect_uri is not None:
        await _kv_set_one(db, REDIRECT_URI_KEY, redirect_uri.strip())
    if provider_label is not None:
        await _kv_set_one(db, PROVIDER_LABEL_KEY, provider_label.strip() or DEFAULT_PROVIDER_LABEL)
    if allow_self_binding is not None:
        await _kv_set_one(db, ALLOW_SELF_BINDING_KEY, bool(allow_self_binding))

    if enabled is not None:
        if enabled:
            # Flush so the read below sees any rows just written in this call.
            await db.flush()
            current = await read_oidc_config(db)
            if not current["issuer"] or not current["client_id"] or not current["has_secret"]:
                raise ServiceError(
                    "oidc_config_incomplete",
                    code=4001,
                    http_status=400,
                    detail={"need": ["issuer", "client_id", "client_secret"]},
                )
        await _kv_set_one(db, ENABLED_KEY, bool(enabled))

    await db.commit()
    return await read_oidc_config(db)


# ── OIDC primitives ────────────────────────────────────────────────────────

# Cache: jwks_uri → (expiry_epoch, jwks_dict). Process-local; 1h TTL.
_JWKS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
# Cache: issuer → (expiry_epoch, discovery_dict). 1h TTL.
_DISCOVERY_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 3600.0


async def fetch_discovery(issuer: str) -> dict[str, Any]:
    """GET ``{issuer}/.well-known/openid-configuration``. Cached for 1h."""
    if not issuer:
        raise ServiceError(
            "oidc_issuer_missing",
            code=4001,
            http_status=400,
        )
    now = time.time()
    cached = _DISCOVERY_CACHE.get(issuer)
    if cached and cached[0] > now:
        return cached[1]

    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise ServiceError(
            "oidc_discovery_failed",
            code=4002,
            http_status=502,
            detail={"message": str(exc)},
        ) from exc

    for required in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not data.get(required):
            raise ServiceError(
                "oidc_discovery_invalid",
                code=4002,
                http_status=502,
                detail={"missing": required},
            )
    _DISCOVERY_CACHE[issuer] = (now + _CACHE_TTL_SECONDS, data)
    return data


async def fetch_jwks(jwks_uri: str) -> dict[str, Any]:
    """GET the JWKS document. Cached for 1h keyed by URI."""
    now = time.time()
    cached = _JWKS_CACHE.get(jwks_uri)
    if cached and cached[0] > now:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(jwks_uri)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise ServiceError(
            "oidc_jwks_fetch_failed",
            code=4003,
            http_status=502,
            detail={"message": str(exc)},
        ) from exc
    _JWKS_CACHE[jwks_uri] = (now + _CACHE_TTL_SECONDS, data)
    return data


def clear_oidc_caches() -> None:
    """Test helper — drop the discovery + JWKS caches."""
    _JWKS_CACHE.clear()
    _DISCOVERY_CACHE.clear()


async def exchange_code(
    *,
    token_endpoint: str,
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """POST to the IdP token endpoint and return the decoded JSON response."""
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                token_endpoint,
                data=data,
                headers={"Accept": "application/json"},
            )
    except httpx.HTTPError as exc:
        raise ServiceError(
            "oidc_token_exchange_failed",
            code=4004,
            http_status=502,
            detail={"message": str(exc)},
        ) from exc

    if resp.status_code >= 400:
        try:
            body = resp.json()
        except Exception:
            body = {"raw": resp.text[:200]}
        raise ServiceError(
            "oidc_token_exchange_rejected",
            code=4004,
            http_status=400,
            detail={"status": resp.status_code, "body": body},
        )
    try:
        return resp.json()
    except Exception as exc:
        raise ServiceError(
            "oidc_token_exchange_invalid_json",
            code=4004,
            http_status=502,
            detail={"message": str(exc)},
        ) from exc


def verify_id_token(
    *,
    id_token: str,
    jwks: dict[str, Any],
    issuer: str,
    audience: str,
    nonce: str | None = None,
) -> dict[str, Any]:
    """Verify signature + standard claims on an ID token. Returns the claims.

    ``nonce`` — when provided, the token's ``nonce`` claim must match.
    """
    try:
        # python-jose can take the full JWKS dict directly as the key.
        claims = jwt.decode(
            id_token,
            jwks,
            algorithms=["RS256", "RS384", "RS512", "ES256", "ES384"],
            audience=audience,
            issuer=issuer,
            options={"verify_at_hash": False},
        )
    except JWTError as exc:
        raise ServiceError(
            "oidc_id_token_invalid",
            code=4005,
            http_status=400,
            detail={"message": str(exc)},
        ) from exc

    if nonce is not None:
        if claims.get("nonce") != nonce:
            raise ServiceError(
                "oidc_nonce_mismatch",
                code=4006,
                http_status=400,
            )
    if not claims.get("sub"):
        raise ServiceError(
            "oidc_subject_missing",
            code=4007,
            http_status=400,
        )
    return claims


__all__ = [
    "OIDC_KEYS",
    "ENABLED_KEY",
    "ISSUER_KEY",
    "CLIENT_ID_KEY",
    "CLIENT_SECRET_ENC_KEY",
    "SCOPES_KEY",
    "REDIRECT_URI_KEY",
    "PROVIDER_LABEL_KEY",
    "ALLOW_SELF_BINDING_KEY",
    "MASK",
    "DEFAULT_SCOPES",
    "DEFAULT_PROVIDER_LABEL",
    "read_oidc_config",
    "resolve_oidc_config",
    "save_oidc_config",
    "fetch_discovery",
    "fetch_jwks",
    "exchange_code",
    "verify_id_token",
    "clear_oidc_caches",
]
