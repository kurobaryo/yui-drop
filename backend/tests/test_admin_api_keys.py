"""Integration tests for /api/admin/api-keys endpoints.

Covers issue/list/get/update/revoke/usage. Uses the ``client`` fixture from
``conftest.py`` (fresh sqlite per test) and the helpers in ``_api_helpers``.
"""
from __future__ import annotations

from tests._api_helpers import (
    admin_headers,
    admin_login,
    issue_key,
)


async def test_admin_can_issue_key_and_plaintext_appears_once(client):
    plaintext, record, token = await issue_key(
        client, note="my-yui-key", scopes=["upload", "read"]
    )
    # Plaintext shape: yd_<8>_<secret>
    assert plaintext.startswith("yd_"), plaintext
    # key_id is exactly 8 chars after "yd_"; secret follows the next "_"
    # (secret may itself contain underscores from token_urlsafe).
    assert plaintext[2] == "_"
    assert plaintext[11] == "_", plaintext
    key_id_part = plaintext[3:11]
    assert key_id_part.isalnum() and key_id_part.islower()
    assert record["note"] == "my-yui-key"
    assert sorted(record["scopes"]) == ["read", "upload"]
    assert record["is_active"] is True
    # Listing must NOT echo plaintext.
    res = await client.get("/api/admin/api-keys", headers=admin_headers(token))
    assert res.status_code == 200, res.text
    items = res.json()["detail"]["items"]
    assert len(items) == 1
    assert "plaintext" not in items[0]
    assert "key_hash" not in items[0]


async def test_admin_create_validates_scopes(client):
    token = await admin_login(client)
    res = await client.post(
        "/api/admin/api-keys",
        headers=admin_headers(token),
        json={"scopes": ["bogus"]},
    )
    # pydantic Literal rejects unknown scope → 422, NOT 400/4001
    # Both shapes are acceptable defenses; assert one of them.
    assert res.status_code in (400, 422), res.text


async def test_admin_list_empty_initially(client):
    token = await admin_login(client)
    res = await client.get("/api/admin/api-keys", headers=admin_headers(token))
    assert res.status_code == 200
    assert res.json()["detail"]["items"] == []


async def test_admin_get_by_id_404_when_missing(client):
    token = await admin_login(client)
    res = await client.get(
        "/api/admin/api-keys/99999", headers=admin_headers(token)
    )
    assert res.status_code == 404, res.text


async def test_admin_patch_updates_note_only(client):
    _, record, token = await issue_key(client, note="old-note")
    key_pk = record["id"]
    res = await client.patch(
        f"/api/admin/api-keys/{key_pk}",
        headers=admin_headers(token),
        json={"note": "new-note"},
    )
    assert res.status_code == 200, res.text
    updated = res.json()["detail"]
    assert updated["note"] == "new-note"
    # Other fields preserved.
    assert updated["quota_daily_bytes"] == record["quota_daily_bytes"]
    assert updated["max_file_size"] == record["max_file_size"]


async def test_admin_patch_no_op_succeeds(client):
    _, record, token = await issue_key(client)
    key_pk = record["id"]
    res = await client.patch(
        f"/api/admin/api-keys/{key_pk}",
        headers=admin_headers(token),
        json={},
    )
    assert res.status_code == 200, res.text
    # Returned record matches original (no fields changed).
    assert res.json()["detail"]["note"] == record["note"]


async def test_admin_patch_clear_expires_at(client):
    _, record, token = await issue_key(client, expires_in_days=365)
    assert record["expires_at"] is not None
    key_pk = record["id"]
    res = await client.patch(
        f"/api/admin/api-keys/{key_pk}",
        headers=admin_headers(token),
        json={"clear_expires_at": True},
    )
    assert res.status_code == 200, res.text
    assert res.json()["detail"]["expires_at"] is None


async def test_admin_revoke_works_and_double_revoke_409(client):
    _, record, token = await issue_key(client)
    key_pk = record["id"]
    res = await client.delete(
        f"/api/admin/api-keys/{key_pk}", headers=admin_headers(token)
    )
    assert res.status_code == 200, res.text
    body = res.json()["detail"]
    assert body["is_active"] is False
    assert body["revoked_at"] is not None
    # Single-key GET confirms.
    res2 = await client.get(
        f"/api/admin/api-keys/{key_pk}", headers=admin_headers(token)
    )
    assert res2.status_code == 200
    assert res2.json()["detail"]["is_active"] is False
    # Double revoke → 409 with code 4002.
    res3 = await client.delete(
        f"/api/admin/api-keys/{key_pk}", headers=admin_headers(token)
    )
    assert res3.status_code == 409, res3.text
    # FastAPI wraps HTTPException(detail=envelope) as {"detail": envelope}
    body = res3.json()["detail"]
    assert body["code"] == 4002, res3.text


async def test_admin_usage_endpoint_zero_when_no_uploads(client):
    _, record, token = await issue_key(client)
    key_pk = record["id"]
    res = await client.get(
        f"/api/admin/api-keys/{key_pk}/usage?days=7",
        headers=admin_headers(token),
    )
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert detail["key_id"] == record["key_id"]
    assert len(detail["days"]) == 7
    for day in detail["days"]:
        assert day["total_bytes"] == 0
        assert day["total_calls"] == 0
    assert detail["totals"] == {"total_bytes": 0, "total_calls": 0}


async def test_admin_routes_require_admin_jwt(client):
    # No Authorization → 401.
    res = await client.get("/api/admin/api-keys")
    assert res.status_code == 401
    # Garbage Bearer → 401.
    res2 = await client.get(
        "/api/admin/api-keys", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert res2.status_code == 401
