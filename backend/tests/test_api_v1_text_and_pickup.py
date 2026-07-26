"""Integration tests for POST /api/v1/share/text and POST /api/v1/pickup.

These two endpoints back the Yui dashboard Drop module's 寄文字 (send text)
and 取件 (pickup) flows. Both are proxied server-side, which is why pickup
failure-tracking is keyed on the API key rather than the caller IP — see
``resolve_share(fail_key=...)``.
"""
from __future__ import annotations

from app.core.rate_limit import retrieve_fail_tracker
from tests._api_helpers import admin_headers, issue_key, key_headers


def _envelope(res):
    """Unwrap FastAPI's `{"detail": envelope}` HTTPException shape."""
    body = res.json().get("detail") or {}
    return body if isinstance(body, dict) else {}


# ── POST /api/v1/share/text ─────────────────────────────────────────────────


async def test_text_share_happy_path(client):
    plaintext, _record, _token = await issue_key(
        client, note="text", scopes=["upload", "read"]
    )
    res = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": "hello from yui", "expire_value": 1, "expire_style": "day"},
    )
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    code = detail["code"]
    assert 5 <= len(code) <= 8
    assert detail["size"] == len(b"hello from yui")
    # Text shares carry no download URL — the body rides in the pickup payload.
    assert detail["url"] is None
    assert detail["short_url"].endswith(f"/s/{code}")


async def test_text_share_appears_in_key_share_list(client):
    """The whole reason this endpoint exists: attribution to the key.

    The anonymous /api/share/text leaves created_by_key_id NULL, so those
    shares are invisible to GET /api/v1/shares.
    """
    plaintext, _record, _token = await issue_key(
        client, note="attrib", scopes=["upload", "read"]
    )
    created = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": "find me in the list"},
    )
    assert created.status_code == 200, created.text
    code = created.json()["detail"]["code"]

    listed = await client.get("/api/v1/shares", headers=key_headers(plaintext))
    assert listed.status_code == 200, listed.text
    body = listed.json()["detail"]
    codes = [item["code"] for item in body["items"]]
    assert code in codes, f"text share {code} missing from {codes}"

    item = next(i for i in body["items"] if i["code"] == code)
    assert item["kind"] == "text"


async def test_anonymous_text_share_not_attributed(client):
    """Control: the public endpoint must NOT leak into a key's share list."""
    plaintext, _record, _token = await issue_key(
        client, note="control", scopes=["upload", "read"]
    )
    anon = await client.post(
        "/api/share/text",
        json={"text": "anonymous body", "expire_value": 1, "expire_style": "day"},
    )
    assert anon.status_code == 200, anon.text
    anon_code = anon.json()["detail"]["code"]

    listed = await client.get("/api/v1/shares", headers=key_headers(plaintext))
    codes = [item["code"] for item in listed.json()["detail"]["items"]]
    assert anon_code not in codes


async def test_text_share_records_usage(client):
    plaintext, record, admin_token = await issue_key(
        client, scopes=["upload", "read"]
    )
    text = "usage accounting"
    res = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": text},
    )
    assert res.status_code == 200, res.text

    usage = await client.get(
        f"/api/admin/api-keys/{record['id']}/usage?days=1",
        headers=admin_headers(admin_token),
    )
    assert usage.status_code == 200
    days = usage.json()["detail"]["days"]
    assert days[-1]["total_calls"] == 1
    assert days[-1]["total_bytes"] == len(text.encode())


async def test_text_share_requires_upload_scope(client):
    plaintext, _record, _token = await issue_key(
        client, note="read-only", scopes=["read"]
    )
    res = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": "should be denied"},
    )
    assert res.status_code == 403, res.text
    assert _envelope(res).get("message") == "scope_denied"


async def test_text_share_no_auth_401(client):
    res = await client.post("/api/v1/share/text", json={"text": "nope"})
    assert res.status_code == 401, res.text
    assert _envelope(res).get("code") == 4011


async def test_text_share_rejects_empty_and_unknown_fields(client):
    plaintext, _record, _token = await issue_key(client, scopes=["upload", "read"])
    empty = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": ""},
    )
    assert empty.status_code == 422, empty.text

    # extra="forbid" on the schema — unknown fields must 422, not be dropped.
    extra = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": "ok", "client": "yui-dashboard"},
    )
    assert extra.status_code == 422, extra.text


# ── POST /api/v1/pickup ─────────────────────────────────────────────────────


async def test_pickup_text_share(client):
    plaintext, _record, _token = await issue_key(client, scopes=["upload", "read"])
    body = "pick me up"
    created = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": body},
    )
    code = created.json()["detail"]["code"]

    got = await client.post(
        "/api/v1/pickup",
        headers=key_headers(plaintext),
        json={"code": code},
    )
    assert got.status_code == 200, got.text
    detail = got.json()["detail"]
    assert detail["kind"] == "text"
    assert detail["text"] == body
    assert detail["used_count"] == 1


async def test_pickup_file_share_returns_absolute_url(client):
    """resolve_share hands back a relative path; v1 must absolutise it."""
    plaintext, _record, _token = await issue_key(client, scopes=["upload", "read"])
    up = await client.post(
        "/api/v1/upload",
        headers=key_headers(plaintext),
        files={"file": ("doc.txt", b"file body", "text/plain")},
    )
    code = up.json()["detail"]["code"]

    got = await client.post(
        "/api/v1/pickup",
        headers=key_headers(plaintext),
        json={"code": code},
    )
    assert got.status_code == 200, got.text
    detail = got.json()["detail"]
    assert detail["kind"] == "file"
    assert detail["name"] == "doc.txt"
    url = detail["url"]
    assert url.startswith("http"), f"expected absolute URL, got {url!r}"
    assert url.endswith(f"/api/share/download/{code}")


async def test_pickup_works_across_keys(client):
    """Pickup is not ownership-scoped — any valid code redeems with any key.

    This differs from GET /api/v1/shares/{code}, which IS ownership-scoped.
    Pickup mirrors the public SPA behaviour: possession of the code is the
    authorisation.
    """
    owner, _r1, admin_token = await issue_key(
        client, note="owner", scopes=["upload", "read"]
    )
    other, _r2, _t = await issue_key(
        client, admin_token=admin_token, note="other", scopes=["upload", "read"]
    )
    created = await client.post(
        "/api/v1/share/text",
        headers=key_headers(owner),
        json={"text": "cross-key"},
    )
    code = created.json()["detail"]["code"]

    got = await client.post(
        "/api/v1/pickup",
        headers=key_headers(other),
        json={"code": code},
    )
    assert got.status_code == 200, got.text
    assert got.json()["detail"]["text"] == "cross-key"

    # Contrast: the ownership-scoped detail endpoint hides it from the other key.
    detail = await client.get(
        f"/api/v1/shares/{code}", headers=key_headers(other)
    )
    assert detail.status_code == 404, detail.text


async def test_pickup_consumes_count_limited_share(client):
    """Pickup decrements expired_count — a 1-download share dies after one."""
    plaintext, _record, _token = await issue_key(client, scopes=["upload", "read"])
    created = await client.post(
        "/api/v1/share/text",
        headers=key_headers(plaintext),
        json={"text": "one shot", "expire_value": 1, "expire_style": "count"},
    )
    code = created.json()["detail"]["code"]

    first = await client.post(
        "/api/v1/pickup", headers=key_headers(plaintext), json={"code": code}
    )
    assert first.status_code == 200, first.text
    assert first.json()["detail"]["expired_count"] == 0

    second = await client.post(
        "/api/v1/pickup", headers=key_headers(plaintext), json={"code": code}
    )
    assert second.status_code == 404, second.text


async def test_pickup_unknown_code_404(client):
    plaintext, _record, _token = await issue_key(client, scopes=["upload", "read"])
    res = await client.post(
        "/api/v1/pickup",
        headers=key_headers(plaintext),
        json={"code": "000000"},
    )
    assert res.status_code == 404, res.text


async def test_pickup_requires_read_scope(client):
    plaintext, _record, _token = await issue_key(
        client, note="upload-only", scopes=["upload"]
    )
    res = await client.post(
        "/api/v1/pickup",
        headers=key_headers(plaintext),
        json={"code": "123456"},
    )
    assert res.status_code == 403, res.text
    assert _envelope(res).get("message") == "scope_denied"


async def test_pickup_no_auth_401(client):
    res = await client.post("/api/v1/pickup", json={"code": "123456"})
    assert res.status_code == 401, res.text
    assert _envelope(res).get("code") == 4011


async def test_pickup_failures_ban_the_key_not_the_host(client):
    """The core reason /api/v1/pickup exists instead of reusing share/select.

    Every v1 caller arrives via a server-side proxy, so they all share one
    source IP. If failure tracking were IP-keyed, one client mistyping codes
    would ban the whole upstream host. Assert the ban is key-scoped: key A
    gets locked out while key B still works from the same IP.
    """
    await retrieve_fail_tracker.reset()

    noisy, _r1, admin_token = await issue_key(
        client, note="noisy", scopes=["upload", "read"]
    )
    quiet, _r2, _t = await issue_key(
        client, admin_token=admin_token, note="quiet", scopes=["upload", "read"]
    )

    # Threshold is 20 failures/hour, and the ban lands ON the 20th (the
    # handler bans when the running count reaches the threshold), so exactly
    # 20 requests still return 404.
    for _ in range(20):
        res = await client.post(
            "/api/v1/pickup",
            headers=key_headers(noisy),
            json={"code": "999999"},
        )
        assert res.status_code == 404, res.text

    # Noisy key is now banned (403, not 404).
    banned = await client.post(
        "/api/v1/pickup", headers=key_headers(noisy), json={"code": "999999"}
    )
    assert banned.status_code == 403, banned.text
    assert _envelope(banned).get("message") == "ip_banned"

    # Same host, different key: still fully functional.
    created = await client.post(
        "/api/v1/share/text",
        headers=key_headers(quiet),
        json={"text": "unaffected"},
    )
    code = created.json()["detail"]["code"]
    ok_res = await client.post(
        "/api/v1/pickup", headers=key_headers(quiet), json={"code": code}
    )
    assert ok_res.status_code == 200, ok_res.text
    assert ok_res.json()["detail"]["text"] == "unaffected"

    await retrieve_fail_tracker.reset()


async def test_pickup_rejects_unknown_fields(client):
    plaintext, _record, _token = await issue_key(client, scopes=["upload", "read"])
    res = await client.post(
        "/api/v1/pickup",
        headers=key_headers(plaintext),
        json={"code": "123456", "client": "yui-dashboard"},
    )
    assert res.status_code == 422, res.text
