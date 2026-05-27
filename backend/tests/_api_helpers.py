"""Shared helpers for the /api/v1 + /api/admin/api-keys integration tests.

Centralises the "log in as admin, mint an API key" boilerplate so the actual
test files can stay focused on assertions. The fixtures in ``conftest.py``
spin up an isolated SQLite database and an ``AsyncClient`` bound to the live
FastAPI app — these helpers operate on that client.
"""
from __future__ import annotations

from typing import Any

# Matches the value set in ``conftest._set_test_env`` before the app is
# imported. Tests are expected to keep this constant in sync if the conftest
# default changes — it's redefined here rather than imported to avoid a
# circular dependency on the conftest module.
ADMIN_PASSWORD = "test-admin-pw"


async def admin_login(client) -> str:
    """Exchange the test admin password for a Bearer JWT.

    Asserts the login succeeds so a misconfigured fixture surfaces as an
    obvious test failure rather than a confusing 401 deeper in the call.
    """
    res = await client.post(
        "/api/admin/login", json={"password": ADMIN_PASSWORD}
    )
    assert res.status_code == 200, res.text
    return res.json()["detail"]["token"]


def admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def key_headers(plaintext: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {plaintext}"}


async def issue_key(
    client,
    *,
    admin_token: str | None = None,
    note: str = "test-key",
    scopes: list[str] | None = None,
    quota_daily_bytes: int | None = None,
    quota_per_minute: int | None = None,
    max_file_size: int | None = None,
    expires_in_days: int | None = None,
) -> tuple[str, dict[str, Any], str]:
    """Issue a fresh API key. Returns ``(plaintext, record_without_plaintext, admin_token)``.

    The ``admin_token`` is reused if supplied — caller can amortise the JWT
    across multiple key-issuance calls in the same test.
    """
    if admin_token is None:
        admin_token = await admin_login(client)

    body: dict[str, Any] = {"note": note}
    if scopes is not None:
        body["scopes"] = scopes
    if quota_daily_bytes is not None:
        body["quota_daily_bytes"] = quota_daily_bytes
    if quota_per_minute is not None:
        body["quota_per_minute"] = quota_per_minute
    if max_file_size is not None:
        body["max_file_size"] = max_file_size
    if expires_in_days is not None:
        body["expires_in_days"] = expires_in_days

    res = await client.post(
        "/api/admin/api-keys",
        headers=admin_headers(admin_token),
        json=body,
    )
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    plaintext = detail["plaintext"]
    record = {k: v for k, v in detail.items() if k != "plaintext"}
    return plaintext, record, admin_token
