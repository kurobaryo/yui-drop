"""Integration tests for /api/admin/auth/methods + /api/admin/oidc/*.

The IdP roundtrip is mocked at the service layer: we monkey-patch the
``admin_oidc`` helpers (``fetch_discovery``, ``fetch_jwks``, ``exchange_code``,
``verify_id_token``) so the callback handler exercises the full state-cookie
+ binding lookup path without touching the network.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.api import admin_auth as admin_auth_api
from app.services import admin_oidc as oidc_svc
from tests._api_helpers import admin_headers, admin_login

# ── Helpers ───────────────────────────────────────────────────────────────


async def _enable_oidc(client, token: str) -> None:
    res = await client.put(
        "/api/admin/oidc/config",
        headers=admin_headers(token),
        json={
            "issuer": "https://idp.example.test/oidc",
            "client_id": "yui-drop-test",
            "client_secret": "super-secret",
            "scopes": "openid profile email",
            "provider_label": "logto",
            "enabled": True,
        },
    )
    assert res.status_code == 200, res.text


# ── /api/admin/auth/methods ───────────────────────────────────────────────


async def test_auth_methods_probe_defaults(client):
    res = await client.get("/api/admin/auth/methods")
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert detail["password_enabled"] is True
    # webauthn table doesn't exist in the test schema (sibling worker owns it).
    assert detail["webauthn_enabled"] is False
    assert detail["oidc_enabled"] is False
    assert detail["oidc_provider_label"] == "oidc"


async def test_auth_methods_reflects_oidc_enable(client):
    token = await admin_login(client)
    await _enable_oidc(client, token)
    res = await client.get("/api/admin/auth/methods")
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert detail["oidc_enabled"] is True
    assert detail["oidc_provider_label"] == "logto"


# ── OIDC disabled → 404 on login/callback ─────────────────────────────────


async def test_oidc_login_404_when_disabled(client):
    res = await client.get("/api/admin/oidc/login", follow_redirects=False)
    assert res.status_code == 404, res.text


async def test_oidc_callback_404_when_disabled(client):
    res = await client.get("/api/admin/oidc/callback?code=x&state=y", follow_redirects=False)
    assert res.status_code == 404, res.text


# ── /api/admin/oidc/config CRUD + masking ─────────────────────────────────


async def test_oidc_config_get_requires_admin(client):
    res = await client.get("/api/admin/oidc/config")
    assert res.status_code == 401, res.text


async def test_oidc_config_default_shape(client):
    token = await admin_login(client)
    res = await client.get("/api/admin/oidc/config", headers=admin_headers(token))
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert detail["enabled"] is False
    assert detail["client_secret"] == ""
    assert detail["has_secret"] is False
    assert detail["provider_label"] == "oidc"
    assert detail["scopes"] == "openid profile email"
    assert detail["effective_redirect_uri"].endswith("/admin/oidc/callback")


async def test_oidc_config_update_masks_secret_and_keeps_on_resave(client):
    token = await admin_login(client)
    # First write — supply a fresh secret.
    res = await client.put(
        "/api/admin/oidc/config",
        headers=admin_headers(token),
        json={
            "issuer": "https://idp.example.test/oidc",
            "client_id": "yui-drop",
            "client_secret": "topsecret",
            "provider_label": "logto",
        },
    )
    assert res.status_code == 200, res.text
    cfg = res.json()["detail"]
    assert cfg["client_secret"] == "****"
    assert cfg["has_secret"] is True

    # Second write — leave the secret alone (frontend sends the mask back).
    res2 = await client.put(
        "/api/admin/oidc/config",
        headers=admin_headers(token),
        json={
            "client_secret": "****",
            "scopes": "openid email",
        },
    )
    assert res2.status_code == 200, res2.text
    cfg2 = res2.json()["detail"]
    assert cfg2["has_secret"] is True  # secret retained
    assert cfg2["scopes"] == "openid email"


async def test_oidc_config_enable_refused_without_required_fields(client):
    token = await admin_login(client)
    res = await client.put(
        "/api/admin/oidc/config",
        headers=admin_headers(token),
        json={"enabled": True},
    )
    assert res.status_code == 400, res.text


# ── Login redirect when enabled ───────────────────────────────────────────


async def test_oidc_login_redirects_when_enabled(client, monkeypatch):
    token = await admin_login(client)
    await _enable_oidc(client, token)

    async def fake_discovery(issuer: str) -> dict[str, Any]:
        return {
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "jwks_uri": f"{issuer}/jwks",
        }

    monkeypatch.setattr(admin_auth_api, "fetch_discovery", fake_discovery)
    oidc_svc.clear_oidc_caches()

    res = await client.get("/api/admin/oidc/login", follow_redirects=False)
    assert res.status_code == 302, res.text
    loc = res.headers["location"]
    assert loc.startswith("https://idp.example.test/oidc/authorize?")
    assert "client_id=yui-drop-test" in loc
    assert "state=" in loc and "nonce=" in loc
    # Signed state cookie set.
    assert "yd_oidc_state=" in res.headers.get("set-cookie", "")


# ── Happy-path callback (with binding) ────────────────────────────────────


def _patch_idp(monkeypatch, *, sub: str, nonce_passthrough: bool = True) -> None:
    """Wire up fake discovery / token-exchange / id-token verify.

    ``nonce_passthrough`` — when True, our fake ``verify_id_token`` accepts
    any nonce. When False, it deliberately fails to simulate a bad-nonce
    response from the IdP.
    """

    async def fake_discovery(issuer: str) -> dict[str, Any]:
        return {
            "authorization_endpoint": f"{issuer}/authorize",
            "token_endpoint": f"{issuer}/token",
            "jwks_uri": f"{issuer}/jwks",
        }

    async def fake_jwks(uri: str) -> dict[str, Any]:
        return {"keys": []}

    async def fake_exchange(**kwargs: Any) -> dict[str, Any]:
        return {"id_token": "stub.id.token", "access_token": "stub", "token_type": "Bearer"}

    def fake_verify(*, id_token, jwks, issuer, audience, nonce):  # noqa: ARG001
        if not nonce_passthrough:
            from app.services.common import ServiceError as _SE

            raise _SE("oidc_nonce_mismatch", code=4006, http_status=400)
        return {
            "sub": sub,
            "iss": issuer,
            "aud": audience,
            "email": "admin@example.test",
            "name": "Test Admin",
            "nonce": nonce,
        }

    monkeypatch.setattr(admin_auth_api, "fetch_discovery", fake_discovery)
    monkeypatch.setattr(admin_auth_api, "fetch_jwks", fake_jwks)
    monkeypatch.setattr(admin_auth_api, "exchange_code", fake_exchange)
    monkeypatch.setattr(admin_auth_api, "verify_id_token", fake_verify)
    oidc_svc.clear_oidc_caches()


async def _login_to_get_state(client) -> tuple[str, str]:
    """Hit /oidc/login, capture the state query param + state cookie value."""
    res = await client.get("/api/admin/oidc/login", follow_redirects=False)
    assert res.status_code == 302, res.text
    # Extract state from the Location URL.
    from urllib.parse import parse_qs, urlparse

    loc = res.headers["location"]
    state = parse_qs(urlparse(loc).query)["state"][0]

    # Extract cookie value from Set-Cookie. httpx stores it in the cookies jar.
    cookie_value = client.cookies.get("yd_oidc_state")
    assert cookie_value, "state cookie not set"
    return state, cookie_value


async def test_oidc_callback_happy_path_with_binding(client, monkeypatch):
    token = await admin_login(client)
    await _enable_oidc(client, token)
    _patch_idp(monkeypatch, sub="user-123")

    # Pre-seed a binding row.
    import app.models as _models  # noqa: F401
    from app.db.session import SessionLocal
    from app.models.oidc_binding import OidcBinding

    async with SessionLocal() as s:
        s.add(OidcBinding(provider="logto", subject="user-123", email="x@y"))
        await s.commit()

    state, _cookie = await _login_to_get_state(client)
    res = await client.get(
        f"/api/admin/oidc/callback?code=fake&state={state}",
        follow_redirects=False,
    )
    assert res.status_code == 302, res.text
    loc = res.headers["location"]
    assert "/admin/oidc/callback?token=" in loc
    assert "expires_at=" in loc


async def test_oidc_callback_missing_binding_redirects_to_error(client, monkeypatch):
    token = await admin_login(client)
    await _enable_oidc(client, token)
    _patch_idp(monkeypatch, sub="unbound-user")

    state, _cookie = await _login_to_get_state(client)
    res = await client.get(
        f"/api/admin/oidc/callback?code=fake&state={state}",
        follow_redirects=False,
    )
    assert res.status_code == 302, res.text
    assert "oidc_error=not_bound" in res.headers["location"]


async def test_oidc_callback_bad_state_redirects_to_error(client, monkeypatch):
    token = await admin_login(client)
    await _enable_oidc(client, token)
    _patch_idp(monkeypatch, sub="user-123")

    # Tampered state — cookie was set for a different value.
    _state, _cookie = await _login_to_get_state(client)
    res = await client.get(
        "/api/admin/oidc/callback?code=fake&state=tampered",
        follow_redirects=False,
    )
    assert res.status_code == 302, res.text
    assert "oidc_error=bad_state" in res.headers["location"]


async def test_oidc_callback_missing_state_cookie(client, monkeypatch):
    token = await admin_login(client)
    await _enable_oidc(client, token)
    _patch_idp(monkeypatch, sub="user-123")

    # Don't go through /oidc/login — fabricate a state without the cookie.
    res = await client.get(
        "/api/admin/oidc/callback?code=fake&state=whatever",
        follow_redirects=False,
    )
    assert res.status_code == 302, res.text
    assert "oidc_error=missing_state_cookie" in res.headers["location"]


# ── Bindings list/delete ──────────────────────────────────────────────────


async def test_oidc_bindings_list_empty(client):
    token = await admin_login(client)
    res = await client.get("/api/admin/oidc/bindings", headers=admin_headers(token))
    assert res.status_code == 200, res.text
    assert res.json()["detail"]["items"] == []


async def test_oidc_bindings_delete(client):
    token = await admin_login(client)
    # Seed a binding directly.
    from app.db.session import SessionLocal
    from app.models.oidc_binding import OidcBinding

    async with SessionLocal() as s:
        row = OidcBinding(provider="logto", subject="x", email="a@b")
        s.add(row)
        await s.commit()
        await s.refresh(row)
        binding_id = row.id

    res = await client.delete(
        f"/api/admin/oidc/bindings/{binding_id}",
        headers=admin_headers(token),
    )
    assert res.status_code == 200, res.text

    res2 = await client.get("/api/admin/oidc/bindings", headers=admin_headers(token))
    assert res2.json()["detail"]["items"] == []


@pytest.fixture(autouse=True)
def _reset_oidc_caches():
    """Ensure cross-test isolation of the in-process discovery/JWKS caches."""
    oidc_svc.clear_oidc_caches()
    yield
    oidc_svc.clear_oidc_caches()
