"""End-to-end tests for the admin theme endpoints + public config exposure.

Covers the contract that makes runtime theme switching work:
  - GET  /api/admin/theme returns defaults on a fresh DB
  - PUT  /api/admin/theme persists a partial update
  - GET  /api/config surfaces the saved theme to anonymous visitors
    (this is the mechanism that avoids a rebuild/redeploy)
  - unknown template slugs are accepted (extensibility contract)
  - hostile input (javascript: logo) is rejected
"""
from __future__ import annotations

import pytest

from ._api_helpers import admin_headers, admin_login


@pytest.mark.asyncio
async def test_theme_defaults(client):
    token = await admin_login(client)
    r = await client.get("/api/admin/theme", headers=admin_headers(token))
    assert r.status_code == 200, r.text
    data = r.json()["detail"]
    assert data["template"] == "linear"
    assert data["mode"] == "auto"
    assert data["lock_mode"] is False
    assert data["brand_name"] == ""


@pytest.mark.asyncio
async def test_theme_partial_update_persists(client):
    token = await admin_login(client)
    h = admin_headers(token)
    r = await client.put(
        "/api/admin/theme",
        json={"template": "apple", "accent": "teal", "brand_name": "My Drop"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    data = r.json()["detail"]
    assert data["template"] == "apple"
    assert data["accent"] == "teal"
    assert data["brand_name"] == "My Drop"
    # Untouched fields keep their defaults.
    assert data["mode"] == "auto"

    # Re-read: the change stuck.
    r2 = await client.get("/api/admin/theme", headers=h)
    assert r2.json()["detail"]["template"] == "apple"


@pytest.mark.asyncio
async def test_theme_reaches_public_config(client):
    """The whole point: an admin change must reach anonymous visitors."""
    token = await admin_login(client)
    await client.put(
        "/api/admin/theme",
        json={"template": "apple", "brand_name": "Branded"},
        headers=admin_headers(token),
    )
    r = await client.get("/api/config")
    assert r.status_code == 200
    cfg = r.json()["detail"]
    assert cfg["theme"]["template"] == "apple"
    # brand_name overrides the env-provided app name.
    assert cfg["appName"] == "Branded"


@pytest.mark.asyncio
async def test_unknown_template_slug_is_accepted(client):
    """Extensibility: the backend must not gatekeep the template list.

    A new front-end template ships as a frontend-only change; the backend
    stores whatever well-shaped slug it is given.
    """
    token = await admin_login(client)
    r = await client.put(
        "/api/admin/theme",
        json={"template": "brand-new-2027"},
        headers=admin_headers(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["detail"]["template"] == "brand-new-2027"


@pytest.mark.asyncio
async def test_hostile_logo_url_rejected(client):
    token = await admin_login(client)
    r = await client.put(
        "/api/admin/theme",
        json={"logo_url": "javascript:alert(1)"},
        headers=admin_headers(token),
    )
    assert r.status_code == 200, r.text
    # Coerced away rather than stored.
    assert r.json()["detail"]["logo_url"] == ""


@pytest.mark.asyncio
async def test_bad_mode_falls_back(client):
    token = await admin_login(client)
    r = await client.put(
        "/api/admin/theme", json={"mode": "purple"}, headers=admin_headers(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["detail"]["mode"] == "auto"


@pytest.mark.asyncio
async def test_theme_requires_admin(client):
    """No anonymous writes to the site's appearance."""
    r = await client.put("/api/admin/theme", json={"template": "apple"})
    assert r.status_code in (401, 403)
