"""DELETE /api/v1/shares/{code} — owner revoke."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.rate_limit import limiter, retrieve_fail_tracker
from app.models.file_code import FileCode
from tests._api_helpers import issue_key, key_headers


@pytest.fixture(autouse=True)
async def _clean_limits():
    limiter.reset()
    await retrieve_fail_tracker.reset()
    yield
    await retrieve_fail_tracker.reset()


def _envelope(res) -> dict:
    body = res.json().get("detail") or {}
    return body if isinstance(body, dict) else {}


async def _file_share(client, plaintext: str, *, style: str = "count", value: int = 3) -> dict:
    res = await client.post(
        "/api/v1/upload",
        headers=key_headers(plaintext),
        files={"file": ("doc.txt", b"revoke me\n", "text/plain")},
        data={"expire_value": str(value), "expire_style": style},
    )
    assert res.status_code == 200, res.text
    return res.json()["detail"]


async def test_revoke_then_pickup_and_download_are_404(client):
    owner, _r, _t = await issue_key(client, scopes=["upload", "read"])
    share = await _file_share(client, owner)
    code = share["code"]

    # URLs handed out before the revoke: the owner's signed URL and a pickup's.
    owner_url = share["url"]
    picked = await client.post("/api/v1/pickup", headers=key_headers(owner), json={"code": code})
    assert picked.status_code == 200
    pickup_url = picked.json()["detail"]["url"]
    assert (await client.get(pickup_url)).status_code == 200

    res = await client.delete(f"/api/v1/shares/{code}", headers=key_headers(owner))
    assert res.status_code == 200, res.text
    assert res.json()["detail"] == {"code": code, "deleted": True}

    again = await client.post("/api/v1/pickup", headers=key_headers(owner), json={"code": code})
    assert again.status_code == 404
    for url in (owner_url, pickup_url):
        dl = await client.get(url)
        assert dl.status_code == 404
        assert _envelope(dl)["message"] == "code_not_found"

    async with _db() as db:
        row = (await db.execute(select(FileCode).where(FileCode.code == code))).scalar_one()
    assert row.deleted_at is not None
    assert row.deleted_reason == "revoked"


async def test_revoke_twice_is_404(client):
    owner, _r, _t = await issue_key(client, scopes=["upload", "read"])
    code = (await _file_share(client, owner))["code"]
    first = await client.delete(f"/api/v1/shares/{code}", headers=key_headers(owner))
    assert first.status_code == 200
    second = await client.delete(f"/api/v1/shares/{code}", headers=key_headers(owner))
    assert second.status_code == 404
    assert _envelope(second) == {"code": 4040, "message": "share_not_found", "detail": None}


async def test_revoke_foreign_or_unknown_share_is_404_and_harmless(client):
    owner, _r, admin = await issue_key(client, scopes=["upload", "read"])
    other, _r2, _t = await issue_key(client, admin_token=admin, scopes=["upload", "read"])
    code = (await _file_share(client, owner))["code"]

    foreign = await client.delete(f"/api/v1/shares/{code}", headers=key_headers(other))
    unknown = await client.delete("/api/v1/shares/000000", headers=key_headers(other))
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.content == unknown.content

    # The owner's share is untouched.
    picked = await client.post("/api/v1/pickup", headers=key_headers(owner), json={"code": code})
    assert picked.status_code == 200
    assert picked.json()["detail"]["expired_count"] == 2


async def test_revoke_text_share(client):
    owner, _r, _t = await issue_key(client, scopes=["upload", "read"])
    created = await client.post(
        "/api/v1/share/text", headers=key_headers(owner), json={"text": "secret note"}
    )
    code = created.json()["detail"]["code"]
    res = await client.delete(f"/api/v1/shares/{code}", headers=key_headers(owner))
    assert res.status_code == 200
    gone = await client.post("/api/share/select", json={"code": code})
    assert gone.status_code == 404


async def test_revoke_requires_upload_scope(client):
    owner, _r, admin = await issue_key(client, scopes=["upload", "read"])
    reader, _r2, _t = await issue_key(client, admin_token=admin, scopes=["read"])
    code = (await _file_share(client, owner))["code"]
    res = await client.delete(f"/api/v1/shares/{code}", headers=key_headers(reader))
    assert res.status_code == 403
    assert _envelope(res)["message"] == "scope_denied"


def _db():
    from app.db import session as session_module

    return session_module.SessionLocal()
