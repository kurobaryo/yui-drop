"""GET /api/config/upload limits for API clients, and GET /api/v1/key."""
from __future__ import annotations

from app.core.config import settings
from tests._api_helpers import admin_headers, issue_key, key_headers


async def test_upload_config_reports_limits_and_features(client):
    res = await client.get("/api/config/upload")
    assert res.status_code == 200
    body = res.json()
    assert body["code"] == 2000
    d = body["detail"]
    # Existing fields stay.
    for k in ("simple_upload_max_bytes", "chunk_upload_max_bytes",
              "multi_total_max_bytes", "chunk_upload_enabled"):
        assert k in d
    assert d["max_file_bytes"] == min(settings.max_upload_bytes, settings.max_file_bytes)
    assert d["max_file_bytes"] == 10 * 1024**3
    assert d["max_share_bytes"] == d["multi_total_max_bytes"] == 10 * 1024**3
    assert d["max_files_per_share"] == 200
    assert d["v1_multipart_ttl_minutes"] == 360
    assert d["v1_features"] == {"multi_send": True, "revoke": True, "owner_view": True}


async def test_max_file_bytes_is_the_smaller_cap(client, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 5 * 1024**3)
    d = (await client.get("/api/config/upload")).json()["detail"]
    assert d["max_file_bytes"] == 5 * 1024**3


async def test_share_cap_is_one_setting(client):
    """The admin multi-file total is both what's advertised and what's enforced."""
    _plain, _rec, admin = await issue_key(client)
    res = await client.put(
        "/api/admin/uploads",
        headers=admin_headers(admin),
        json={"multi_total_max_bytes": 1000},
    )
    assert res.status_code == 200, res.text
    d = (await client.get("/api/config/upload")).json()["detail"]
    assert d["max_share_bytes"] == d["multi_total_max_bytes"] == 1000

    key, _r, _t = await issue_key(client, admin_token=admin, scopes=["upload", "read"])
    over = await client.post(
        "/api/v1/share/multi", headers=key_headers(key),
        json={"declared_file_count": 1, "declared_total_size": 1001},
    )
    assert over.status_code == 400
    assert over.json()["detail"]["message"] == "share_quota_exceeded"


async def test_key_endpoint_describes_any_valid_key(client):
    plaintext, record, admin = await issue_key(
        client, scopes=["read"], max_file_size=12345, quota_daily_bytes=67890
    )
    res = await client.get("/api/v1/key", headers=key_headers(plaintext))
    assert res.status_code == 200, res.text
    d = res.json()["detail"]
    assert d == {
        "key_id": record["key_id"],
        "scopes": ["read"],
        "max_file_size": 12345,
        "quota_daily_bytes": 67890,
    }
    assert plaintext not in res.text

    upload_only, rec2, _t = await issue_key(client, admin_token=admin, scopes=["upload"])
    res = await client.get("/api/v1/key", headers=key_headers(upload_only))
    assert res.status_code == 200 and res.json()["detail"]["scopes"] == ["upload"]


async def test_key_endpoint_requires_a_key(client):
    assert (await client.get("/api/v1/key")).status_code == 401
    bad = await client.get("/api/v1/key", headers=key_headers("yd_abcdefgh_" + "x" * 32))
    assert bad.status_code == 401
