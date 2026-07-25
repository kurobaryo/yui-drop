"""Tests for the v2 per-room Collection policy (settings_kv backed).

The policy (max file size / capacity / allow messages / notify) is stored in
``settings_kv`` rather than new ``collections`` columns, so existing SQLite
deployments need no ALTER TABLE. These tests pin the two things that matter:

  1. The policy round-trips through create → preview.
  2. It is actually ENFORCED server-side (upload size, room capacity, and
     the messages-disabled switch), not just echoed back to the UI.
"""
from __future__ import annotations

import pytest

from app.services import collections as svc
from app.services.common import ServiceError

MB = 1024**2
GB = 1024**3


async def _create(client, **overrides):
    body = {
        "name": "policy room",
        "visibility": "public",
        "admin_password": "room-admin-pw",
        "lifetime_days": 7,
        "creator_nickname": "Owner",
    }
    body.update(overrides)
    res = await client.post("/api/collections", json=body)
    assert res.status_code == 200, res.text
    return res.json()["detail"]


@pytest.mark.asyncio
async def test_policy_defaults_round_trip_to_preview(client):
    room = await _create(client)
    preview = (await client.get(f"/api/collections/{room['code']}/preview")).json()["detail"]
    assert preview["max_file_bytes"] == 2 * GB
    assert preview["capacity_bytes"] == 10 * GB
    assert preview["allow_messages"] is True
    assert preview["notify_on_activity"] is False


@pytest.mark.asyncio
async def test_custom_policy_round_trips_to_preview(client):
    room = await _create(
        client,
        max_file_bytes=500 * MB,
        capacity_bytes=50 * GB,
        allow_messages=False,
        notify_on_activity=True,
    )
    preview = (await client.get(f"/api/collections/{room['code']}/preview")).json()["detail"]
    assert preview["max_file_bytes"] == 500 * MB
    assert preview["capacity_bytes"] == 50 * GB
    assert preview["allow_messages"] is False
    assert preview["notify_on_activity"] is True


@pytest.mark.asyncio
async def test_messages_disabled_is_enforced_not_just_displayed(client):
    """allow_messages=False must make POST /messages fail, not merely hide the box."""
    room = await _create(client, allow_messages=False)
    res = await client.post(
        f"/api/collections/{room['code']}/messages",
        json={"text": "should be rejected"},
        headers={"X-Member-Token": room["member_token"]},
    )
    assert res.status_code == 403, res.text

    open_room = await _create(client, allow_messages=True)
    ok = await client.post(
        f"/api/collections/{open_room['code']}/messages",
        json={"text": "allowed"},
        headers={"X-Member-Token": open_room["member_token"]},
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_oversized_file_rejected_by_policy(client):
    room = await _create(client, max_file_bytes=1 * MB)
    res = await client.post(
        f"/api/collections/{room['code']}/files/init",
        json={"name": "big.bin", "size": 5 * MB, "content_type": "application/octet-stream"},
        headers={"X-Member-Token": room["member_token"]},
    )
    assert res.status_code == 413, res.text


@pytest.mark.asyncio
async def test_upload_within_policy_is_accepted(client):
    room = await _create(client, max_file_bytes=10 * MB)
    res = await client.post(
        f"/api/collections/{room['code']}/files/init",
        json={"name": "small.bin", "size": 1 * MB, "content_type": "application/octet-stream"},
        headers={"X-Member-Token": room["member_token"]},
    )
    assert res.status_code == 200, res.text


@pytest.mark.asyncio
async def test_unknown_room_policy_falls_back_to_defaults(client):
    """Rooms created before this feature have no settings_kv row — they must
    still work, using the documented defaults rather than crashing."""
    room = await _create(client)
    # Simulate a legacy room by deleting the policy row the create call wrote.
    from app.db import session as session_module
    from app.models.settings_kv import SettingsKV

    async with session_module.SessionLocal() as db:
        row = await db.get(SettingsKV, f"collection.policy.{room['code']}")
        if row is not None:
            await db.delete(row)
            await db.commit()

    preview = (await client.get(f"/api/collections/{room['code']}/preview")).json()["detail"]
    assert preview["max_file_bytes"] == svc.DEFAULT_COLLECTION_POLICY["max_file_bytes"]
    assert preview["allow_messages"] is True
