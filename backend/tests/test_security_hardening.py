"""Security regression tests for runtime configuration and request trust."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


def _fake_request(headers: dict[str, str], client_host: str | None = "203.0.113.10"):
    req = MagicMock()
    req.headers = headers
    if client_host is None:
        req.client = None
    else:
        req.client = MagicMock()
        req.client.host = client_host
    return req


def test_real_client_ip_ignores_forwarded_headers_from_untrusted_peer(monkeypatch):
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit.settings, "trusted_proxy_ips", "10.0.0.1")
    req = _fake_request(
        {
            "CF-Connecting-IP": "1.2.3.4",
            "X-Forwarded-For": "5.6.7.8",
            "X-Real-IP": "9.9.9.9",
        },
        client_host="203.0.113.10",
    )

    assert rate_limit.real_client_ip(req) == "203.0.113.10"


def test_real_client_ip_accepts_forwarded_headers_from_trusted_proxy(monkeypatch):
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit.settings, "trusted_proxy_ips", "10.0.0.1,127.0.0.1")
    req = _fake_request(
        {
            "CF-Connecting-IP": "1.2.3.4",
            "X-Forwarded-For": "5.6.7.8",
        },
        client_host="10.0.0.1",
    )

    assert rate_limit.real_client_ip(req) == "1.2.3.4"


def test_jwt_secret_guard_rejects_empty_and_short_values(monkeypatch):
    from app.main import _require_jwt_secret_or_die

    monkeypatch.setattr("app.main.settings.jwt_secret", "")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _require_jwt_secret_or_die()

    monkeypatch.setattr("app.main.settings.jwt_secret", "short")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _require_jwt_secret_or_die()


def test_jwt_secret_guard_accepts_strong_value(monkeypatch):
    from app.main import _require_jwt_secret_or_die

    monkeypatch.setattr("app.main.settings.jwt_secret", "a" * 40)

    _require_jwt_secret_or_die()


async def test_admin_login_turnstile_gate_when_enabled(client, monkeypatch):
    from tests._api_helpers import ADMIN_PASSWORD

    async def fake_resolve(_db):
        return {
            "enabled": True,
            "site_key": "site",
            "secret_key": "secret",
            "protect_upload": False,
            "protect_pickup": False,
            "protect_admin_login": True,
        }

    async def fake_verify(token: str, remote_ip: str | None = None, *, db=None):
        return token == "ok-token"

    monkeypatch.setattr("app.api.admin.resolve_turnstile_config", fake_resolve)
    monkeypatch.setattr("app.api.admin.verify_turnstile", fake_verify)

    denied = await client.post(
        "/api/admin/login",
        json={"password": ADMIN_PASSWORD, "turnstile_token": "bad-token"},
    )
    assert denied.status_code == 400, denied.text
    assert denied.json()["code"] == 4003

    allowed = await client.post(
        "/api/admin/login",
        json={"password": ADMIN_PASSWORD, "turnstile_token": "ok-token"},
    )
    assert allowed.status_code == 200, allowed.text
