"""Integration tests for /api/v1 endpoints.

Covers simple upload, share listing, ownership, auth failures, quota
enforcement, and multipart init. Uses the ``client`` fixture from
``conftest.py`` (fresh sqlite per test) and the helpers in ``_api_helpers``.
"""
from __future__ import annotations

import pytest

from tests._api_helpers import (
    admin_headers,
    issue_key,
    key_headers,
)


def _envelope(res):
    """Unwrap FastAPI's `{"detail": envelope}` HTTPException shape.

    Project convention is to raise HTTPException(detail={code, message, detail}).
    FastAPI wraps that in another `{"detail": ...}`, so the project envelope
    lives one level deep on errors.
    """
    body = res.json().get("detail") or {}
    return body if isinstance(body, dict) else {}


async def test_v1_upload_happy_path(client):
    plaintext, _record, _token = await issue_key(
        client, note="happy", scopes=["upload", "read"]
    )
    payload = b"hi!"
    res = await client.post(
        "/api/v1/upload",
        headers=key_headers(plaintext),
        files={"file": ("hi.txt", payload, "text/plain")},
        data={"expire_value": "1", "expire_style": "day"},
    )
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    code = detail["code"]
    assert 5 <= len(code) <= 8
    assert detail["size"] == len(payload)
    assert detail["url"].endswith(f"/api/share/download/{code}")
    assert detail["short_url"].endswith(f"/s/{code}")


async def test_v1_upload_records_usage(client):
    plaintext, record, admin_token = await issue_key(client)
    payload = b"hi!"
    up = await client.post(
        "/api/v1/upload",
        headers=key_headers(plaintext),
        files={"file": ("hi.txt", payload, "text/plain")},
    )
    assert up.status_code == 200, up.text
    # Usage rollup increments on success.
    usage = await client.get(
        f"/api/admin/api-keys/{record['id']}/usage?days=1",
        headers=admin_headers(admin_token),
    )
    assert usage.status_code == 200
    days = usage.json()["detail"]["days"]
    assert days[-1]["total_calls"] == 1
    assert days[-1]["total_bytes"] == len(payload)


async def test_v1_upload_no_auth_401(client):
    res = await client.post(
        "/api/v1/upload",
        files={"file": ("x.txt", b"x", "text/plain")},
    )
    assert res.status_code == 401, res.text
    body = _envelope(res)
    assert body.get("code") == 4011, res.text


async def test_v1_upload_invalid_key_401(client):
    res = await client.post(
        "/api/v1/upload",
        headers={"Authorization": "Bearer yd_garbage_garbage"},
        files={"file": ("x.txt", b"x", "text/plain")},
    )
    assert res.status_code == 401, res.text
    body = _envelope(res)
    assert body.get("code") == 4011, res.text


async def test_v1_upload_revoked_key_401(client):
    plaintext, record, admin_token = await issue_key(client)
    # Revoke.
    rv = await client.delete(
        f"/api/admin/api-keys/{record['id']}",
        headers=admin_headers(admin_token),
    )
    assert rv.status_code == 200
    # Try to upload → 401. Revoked keys have revoked_at set, so DB lookup
    # filters them out → indistinguishable from "no such key" by design
    # (enumeration defense). Accept 4011 here.
    res = await client.post(
        "/api/v1/upload",
        headers=key_headers(plaintext),
        files={"file": ("x.txt", b"x", "text/plain")},
    )
    assert res.status_code == 401, res.text
    body = _envelope(res)
    assert body.get("code") in (4011, 4012), res.text


async def test_v1_upload_wrong_scope_403(client):
    plaintext, _record, _admin = await issue_key(client, scopes=["read"])
    res = await client.post(
        "/api/v1/upload",
        headers=key_headers(plaintext),
        files={"file": ("x.txt", b"x", "text/plain")},
    )
    assert res.status_code == 403, res.text
    body = _envelope(res)
    assert body.get("code") == 4031, res.text


async def test_v1_upload_file_too_large_413(client):
    plaintext, _record, _admin = await issue_key(client, max_file_size=10)
    payload = b"x" * 20
    res = await client.post(
        "/api/v1/upload",
        headers=key_headers(plaintext),
        files={"file": ("big.bin", payload, "application/octet-stream")},
    )
    assert res.status_code == 413, res.text
    body = _envelope(res)
    assert body.get("code") == 4293, res.text


async def test_v1_list_shares_returns_only_owned(client):
    plain_a, _ra, admin_token = await issue_key(client, note="A")
    plain_b, _rb, _ = await issue_key(client, note="B", admin_token=admin_token)

    # Upload one file via key A.
    up_a = await client.post(
        "/api/v1/upload",
        headers=key_headers(plain_a),
        files={"file": ("a.txt", b"a", "text/plain")},
    )
    assert up_a.status_code == 200, up_a.text
    # Upload one file via key B.
    up_b = await client.post(
        "/api/v1/upload",
        headers=key_headers(plain_b),
        files={"file": ("b.txt", b"b", "text/plain")},
    )
    assert up_b.status_code == 200, up_b.text

    # Key A sees only its own share.
    list_a = await client.get(
        "/api/v1/shares", headers=key_headers(plain_a)
    )
    assert list_a.status_code == 200, list_a.text
    items_a = list_a.json()["detail"]["items"]
    assert len(items_a) == 1
    assert items_a[0]["code"] == up_a.json()["detail"]["code"]

    # Key B sees only its own share.
    list_b = await client.get(
        "/api/v1/shares", headers=key_headers(plain_b)
    )
    assert list_b.status_code == 200
    items_b = list_b.json()["detail"]["items"]
    assert len(items_b) == 1
    assert items_b[0]["code"] == up_b.json()["detail"]["code"]


async def test_v1_list_shares_wrong_scope_403(client):
    plaintext, _record, _admin = await issue_key(client, scopes=["upload"])
    res = await client.get("/api/v1/shares", headers=key_headers(plaintext))
    assert res.status_code == 403, res.text
    body = _envelope(res)
    assert body.get("code") == 4031, res.text


async def test_v1_get_share_404_when_not_owned(client):
    plain_a, _ra, admin_token = await issue_key(client, note="A")
    plain_b, _rb, _ = await issue_key(client, note="B", admin_token=admin_token)

    up = await client.post(
        "/api/v1/upload",
        headers=key_headers(plain_a),
        files={"file": ("a.txt", b"a", "text/plain")},
    )
    assert up.status_code == 200
    code = up.json()["detail"]["code"]

    # Key B asks about A's share → 404 (ownership scoped).
    res = await client.get(
        f"/api/v1/shares/{code}", headers=key_headers(plain_b)
    )
    assert res.status_code == 404, res.text


async def test_v1_multipart_init_returns_presign_data(client):
    # Local backend in tests doesn't support multipart — skip cleanly.
    from app.core.config import settings as app_settings
    if getattr(app_settings, "storage_backend", "local") != "s3":
        pytest.skip("multipart init requires S3-compatible storage backend")

    plaintext, _record, _admin = await issue_key(client)
    res = await client.post(
        "/api/v1/upload/init",
        headers=key_headers(plaintext),
        json={
            "file_name": "big.bin",
            "file_size": 6 * 1024 * 1024,
            "expire_value": 1,
            "expire_style": "day",
        },
    )
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert "upload_id" in detail
    assert detail["part_size"] >= 5 * 1024 * 1024
    assert detail["parts_total"] >= 1
    assert "expires_at" in detail
