"""GET /api/v1/shares: per-row status, history window, owner content view."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.rate_limit import limiter, retrieve_fail_tracker
from app.models.file_code import FileCode
from tests._api_helpers import issue_key, key_headers


@pytest.fixture(autouse=True)
async def _clean_limits():
    limiter.reset()
    await retrieve_fail_tracker.reset()
    yield
    await retrieve_fail_tracker.reset()


def _db():
    from app.db import session as session_module

    return session_module.SessionLocal()


async def _update(code: str, **values) -> None:
    async with _db() as db:
        row = (await db.execute(select(FileCode).where(FileCode.code == code))).scalar_one()
        for k, v in values.items():
            setattr(row, k, v)
        await db.commit()


async def _text(client, key: str, body: str = "hello", **expire) -> str:
    res = await client.post(
        "/api/v1/share/text", headers=key_headers(key), json={"text": body, **expire}
    )
    assert res.status_code == 200, res.text
    return res.json()["detail"]["code"]


async def _list(client, key: str, status: str) -> dict[str, dict]:
    res = await client.get(f"/api/v1/shares?status={status}", headers=key_headers(key))
    assert res.status_code == 200, res.text
    body = res.json()["detail"]
    assert body["total"] == len(body["items"])
    return {i["code"]: i for i in body["items"]}


async def test_rows_carry_status_and_history_is_kept_30_days(client):
    from app.db import session as session_module
    from app.services.retention import sweep_once

    key, _r, _t = await issue_key(client, scopes=["upload", "read"])
    live = await _text(client, key, "live")
    swept = await _text(client, key, "swept")
    revoked = await _text(client, key, "revoked")
    old = await _text(client, key, "old")

    # One share ran out 15 minutes ago and has been swept since.
    await _update(swept, expired_at=datetime.now(tz=UTC) - timedelta(minutes=15))
    await sweep_once(session_module.SessionLocal)
    assert (await client.delete(f"/api/v1/shares/{revoked}", headers=key_headers(key))).status_code == 200
    # One was revoked long ago — beyond the history window.
    await client.delete(f"/api/v1/shares/{old}", headers=key_headers(key))
    await _update(old, deleted_at=datetime.now(tz=UTC) - timedelta(days=settings.share_history_days + 1))

    active = await _list(client, key, "active")
    expired = await _list(client, key, "expired")
    every = await _list(client, key, "all")

    assert set(active) == {live}
    assert active[live]["status"] == "active"
    assert set(expired) == {swept, revoked}
    assert expired[swept]["status"] == "expired"
    assert expired[revoked]["status"] == "revoked"
    assert set(every) == {live, swept, revoked}
    assert old not in every

    # The detail view follows the same window.
    gone = await client.get(f"/api/v1/shares/{swept}", headers=key_headers(key))
    assert gone.status_code == 200 and gone.json()["detail"]["status"] == "expired"
    too_old = await client.get(f"/api/v1/shares/{old}", headers=key_headers(key))
    assert too_old.status_code == 404


async def test_run_out_but_unswept_rows_are_expired(client):
    key, _r, _t = await issue_key(client, scopes=["upload", "read"])
    code = await _text(client, key, expire_value=1, expire_style="count")
    other, _r2, _t2 = await issue_key(client, scopes=["read"])
    assert (await client.post("/api/v1/pickup", headers=key_headers(other), json={"code": code})).status_code == 200
    expired = await _list(client, key, "expired")
    assert expired[code]["status"] == "expired"
    assert code not in await _list(client, key, "active")


async def test_legacy_deleted_rows_get_a_sensible_status(client):
    """Rows soft-deleted before deleted_reason existed have it NULL."""
    key, _r, _t = await issue_key(client, scopes=["upload", "read"])
    timed_out = await _text(client, key)
    removed = await _text(client, key)
    now = datetime.now(tz=UTC)
    await _update(timed_out, expired_at=now - timedelta(minutes=5), deleted_at=now)
    await _update(removed, deleted_at=now)
    rows = await _list(client, key, "expired")
    assert rows[timed_out]["status"] == "expired"
    assert rows[removed]["status"] == "revoked"


async def test_owner_reads_text_content_without_spending_a_pickup(client):
    key, _r, admin = await issue_key(client, scopes=["upload", "read"])
    body = "the full body ✓"
    code = await _text(client, key, body, expire_value=1, expire_style="count")

    plain = await client.get(f"/api/v1/shares/{code}", headers=key_headers(key))
    assert "text" not in plain.json()["detail"]

    for _ in range(2):
        res = await client.get(f"/api/v1/shares/{code}?include=content", headers=key_headers(key))
        assert res.status_code == 200, res.text
        detail = res.json()["detail"]
        assert detail["text"] == body
        assert detail["used_count"] == 0 and detail["expired_count"] == 1

    # The receiver's single pickup still works.
    picked = await client.post("/api/share/select", json={"code": code})
    assert picked.status_code == 200 and picked.json()["detail"]["text"] == body


async def test_owner_reads_multi_content_with_signed_urls(client):
    key, _r, _t = await issue_key(client, scopes=["upload", "read"])
    files = [("a.txt", b"first\n"), ("b.txt", b"second\n")]
    created = await client.post(
        "/api/v1/share/multi", headers=key_headers(key),
        json={"declared_file_count": 2, "declared_total_size": 13, "text": "see both",
              "expire_value": 1, "expire_style": "count"},
    )
    sid, code = created.json()["detail"]["share_id"], created.json()["detail"]["code"]
    for name, data in files:
        f = (await client.post(
            f"/api/v1/share/multi/{sid}/files", headers=key_headers(key),
            json={"name": name, "size": len(data)},
        )).json()["detail"]
        p = (await client.post(
            f"/api/v1/share/multi/{sid}/files/{f['file_id']}/parts/1", headers=key_headers(key),
            files={"chunk": ("b", data, "application/octet-stream")},
        )).json()["detail"]
        done = await client.post(
            f"/api/v1/share/multi/{sid}/files/{f['file_id']}/complete", headers=key_headers(key),
            json={"parts": [p]},
        )
        assert done.status_code == 200, done.text
    assert (await client.post(f"/api/v1/share/multi/{sid}/finalize", headers=key_headers(key))).status_code == 200

    res = await client.get(f"/api/v1/shares/{code}?include=content", headers=key_headers(key))
    detail = res.json()["detail"]
    assert detail["text"] == "see both"
    assert [f["name"] for f in detail["files"]] == ["a.txt", "b.txt"]
    for f, (_n, data) in zip(detail["files"], files, strict=True):
        assert isinstance(f["file_id"], str)
        assert f["url"].startswith("http")
        u = urlsplit(f["url"])
        got = await client.get(f"{u.path}?{u.query}")
        assert got.status_code == 200 and got.content == data
    after = (await client.get(f"/api/v1/shares/{code}", headers=key_headers(key))).json()["detail"]
    assert after["used_count"] == 0 and after["expired_count"] == 1

    # Revoked → metadata only.
    await client.delete(f"/api/v1/shares/{code}", headers=key_headers(key))
    res = await client.get(f"/api/v1/shares/{code}?include=content", headers=key_headers(key))
    detail = res.json()["detail"]
    assert detail["status"] == "revoked"
    assert detail["text"] is None and detail["files"] == [] and detail["url"] is None


async def test_include_content_on_foreign_share_is_404(client):
    owner, _r, admin = await issue_key(client, scopes=["upload", "read"])
    other, _r2, _t = await issue_key(client, admin_token=admin, scopes=["upload", "read"])
    code = await _text(client, owner, "private")
    res = await client.get(f"/api/v1/shares/{code}?include=content", headers=key_headers(other))
    assert res.status_code == 404
    assert "private" not in res.text
