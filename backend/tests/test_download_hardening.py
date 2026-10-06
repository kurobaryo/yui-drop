"""Download route hardening: signed tokens, one uniform 404, ban, rate limit.

``GET /api/share/download/{code}[/{file_id}]`` used to serve any live share
to anyone who knew the code, without spending a pickup, with a distinct error
per failure reason and no failure tracking. These tests pin the replacement:

* pickups hand out URLs with a short-lived signed ``t`` token; the token is
  the grace window that lets a receiver download after the last pickup;
* without a token only time-limited shares are served (mode ``counted``),
  or nothing at all (mode ``all``);
* every refusal is the same 404 body and counts towards the IP ban that
  pickup uses;
* the route is rate limited per IP.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select

from app.core import download_token
from app.core.config import settings
from app.core.download_token import mint_download_token
from app.core.rate_limit import limiter, retrieve_fail_tracker
from app.models.file_code import FileCode
from tests._api_helpers import admin_headers, admin_login


@pytest.fixture(autouse=True)
async def _clean_limits():
    limiter.reset()
    await retrieve_fail_tracker.reset()
    yield
    limiter.reset()
    await retrieve_fail_tracker.reset()


def _db():
    # The client fixture points SessionLocal at the per-test database.
    from app.db import session as session_module

    return session_module.SessionLocal()


async def _row(code: str) -> FileCode:
    async with _db() as db:
        return (await db.execute(select(FileCode).where(FileCode.code == code))).scalar_one()


async def _update(code: str, **values: Any) -> None:
    async with _db() as db:
        row = (await db.execute(select(FileCode).where(FileCode.code == code))).scalar_one()
        for k, v in values.items():
            setattr(row, k, v)
        await db.commit()


async def _upload(client, *, style: str = "hour", value: int = 1, body: bytes = b"payload\n") -> str:
    res = await client.post(
        "/api/share/file",
        files={"file": ("doc.txt", body, "text/plain")},
        data={"expire_value": str(value), "expire_style": style},
    )
    assert res.status_code == 200, res.text
    return res.json()["detail"]["code"]


async def _text(client) -> str:
    res = await client.post("/api/share/text", json={"text": "just words"})
    assert res.status_code == 200, res.text
    return res.json()["detail"]["code"]


async def _multi(client, *, finalize: bool = True) -> tuple[str, int, int]:
    """Anonymous one-file multi share. Returns ``(code, share_id, file_id)``."""
    payload = b"member file\n"
    init = await client.post(
        "/api/share/multi/init",
        json={
            "declared_file_count": 1,
            "declared_total_size": len(payload),
            "expire_value": 1,
            "expire_style": "count",
        },
    )
    assert init.status_code == 200, init.text
    d = init.json()["detail"]
    headers = {"Authorization": f"Bearer {d['upload_token']}"}
    f = await client.post(
        f"/api/share/multi/{d['share_id']}/file/init",
        headers=headers,
        json={"name": "m.txt", "size": len(payload), "declared_chunked": True, "chunk_size": 1024},
    )
    assert f.status_code == 200, f.text
    fd = f.json()["detail"]
    part = await client.post(
        f"/api/chunk/upload/{fd['upload_id']}/0",
        files={"chunk": ("blob", payload, "application/octet-stream")},
    )
    assert part.status_code == 200, part.text
    done = await client.post(
        f"/api/share/multi/{d['share_id']}/file/{fd['file_id']}/complete",
        headers=headers,
        json={"total_uploaded_bytes": len(payload)},
    )
    assert done.status_code == 200, done.text
    if finalize:
        fin = await client.post(f"/api/share/multi/{d['share_id']}/finalize", headers=headers)
        assert fin.status_code == 200, fin.text
    return d["code"], d["share_id"], fd["file_id"]


async def _pickup(client, code: str) -> dict[str, Any]:
    res = await client.post("/api/share/select", json={"code": code})
    assert res.status_code == 200, res.text
    return res.json()["detail"]


# ── One uniform 404 ─────────────────────────────────────────────────────────


async def test_every_refusal_is_the_same_404(client):
    """The six historic reasons (plus token / id junk) are indistinguishable."""
    single = await _upload(client)
    counted = await _upload(client, style="count", value=2)
    expired = await _upload(client)
    await _update(expired, expired_at=datetime.now(tz=UTC) - timedelta(minutes=1))
    text = await _text(client)
    multi, _sid, _fid = await _multi(client)
    # Multi shares are count-limited here, so give the probe a valid token
    # for the right code but no file (the most a prober could hold).
    multi_row = await _row(multi)
    multi_tok = mint_download_token(multi_row.id, multi, None)

    probes = [
        "/api/share/download/000000",                      # code_not_found
        f"/api/share/download/{expired}",                  # code_expired
        f"/api/share/download/{text}",                     # not_a_file_share
        f"/api/share/download/{multi}?t={multi_tok}",      # file_id_required
        f"/api/share/download/{multi}/999999",             # file_not_found
        f"/api/share/download/{single}/999999",            # file_id_not_applicable
        f"/api/share/download/{counted}?t=1.9999999999.forged",  # bad token
        f"/api/share/download/{counted}",                  # no token, count-limited
        f"/api/share/download/{multi}/not-a-number",       # junk file id
    ]
    bodies = set()
    for url in probes:
        res = await client.get(url)
        assert res.status_code == 404, (url, res.text)
        bodies.add(res.content)
    assert bodies == {b'{"detail":{"code":4040,"message":"code_not_found","detail":null}}'}


async def test_invalid_token_is_treated_as_no_token(client):
    """A time-limited share stays downloadable with a junk ``t``: stripping
    the parameter would give the same answer, so refusing protects nothing."""
    code = await _upload(client)
    res = await client.get(f"/api/share/download/{code}?t=1.2.forged")
    assert res.status_code == 200, res.text


async def test_misses_on_download_route_ban_like_pickup(client):
    good = await _upload(client)
    threshold = settings.rate_limit_retrieve_fails_per_hour
    for _ in range(threshold):
        res = await client.get("/api/share/download/000000")
        assert res.status_code == 404, res.text

    banned_dl = await client.get(f"/api/share/download/{good}")
    banned_pick = await client.post("/api/share/select", json={"code": good})
    assert banned_dl.status_code == banned_pick.status_code == 403
    assert banned_dl.content == banned_pick.content
    assert banned_dl.json()["detail"]["message"] == "ip_banned"


async def test_download_success_does_not_reset_the_miss_counter(client):
    """Interleaving a good download must not let a prober dodge the ban."""
    good = await _upload(client)
    threshold = settings.rate_limit_retrieve_fails_per_hour
    for i in range(threshold - 1):
        assert (await client.get("/api/share/download/000000")).status_code == 404
        if i % 5 == 0:
            assert (await client.get(f"/api/share/download/{good}")).status_code == 200
    assert (await client.get("/api/share/download/000001")).status_code == 404
    assert (await client.get(f"/api/share/download/{good}")).status_code == 403


# ── Tokens and the grace window ─────────────────────────────────────────────


async def test_count_one_share_downloads_within_ttl_then_404(client, monkeypatch):
    code = await _upload(client, style="count", value=1)

    # Before any pickup: no token, count-limited → refused.
    assert (await client.get(f"/api/share/download/{code}")).status_code == 404

    picked = await _pickup(client, code)
    assert picked["expired_count"] == 0
    url = picked["url"]
    assert "?t=" in url

    first = await client.get(url)
    assert first.status_code == 200
    assert first.content == b"payload\n"
    # Same token, again, still inside the window — and with ?dl=1 appended.
    again = await client.get(f"{url}&dl=1")
    assert again.status_code == 200
    assert again.headers["content-disposition"].startswith("attachment;")
    # The count is spent: no further pickup, and no tokenless download.
    assert (await client.post("/api/share/select", json={"code": code})).status_code == 404
    assert (await client.get(f"/api/share/download/{code}")).status_code == 404

    # Sixteen minutes later the token is dead.
    real_clock = download_token._clock
    monkeypatch.setattr(
        download_token, "_clock", lambda: real_clock() + (settings.download_token_ttl_min + 1) * 60
    )
    late = await client.get(url)
    assert late.status_code == 404
    assert late.json()["detail"]["message"] == "code_not_found"


async def test_sweeper_keeps_exhausted_share_until_token_window_passes(client):
    from app.db import session as session_module
    from app.services.retention import sweep_once

    code = await _upload(client, style="count", value=1)
    picked = await _pickup(client, code)

    await sweep_once(session_module.SessionLocal)
    row = await _row(code)
    assert row.deleted_at is None, "swept while the pickup's links are still valid"
    assert (await client.get(picked["url"])).status_code == 200

    await _update(
        code,
        last_pickup_at=datetime.now(tz=UTC)
        - timedelta(minutes=settings.download_token_ttl_min + 1),
    )
    await sweep_once(session_module.SessionLocal)
    row = await _row(code)
    assert row.deleted_at is not None
    assert row.deleted_reason == "expired"


async def test_sweeper_marks_time_expired_rows(client):
    from app.db import session as session_module
    from app.services.retention import sweep_once

    code = await _upload(client)
    await _update(code, expired_at=datetime.now(tz=UTC) - timedelta(seconds=1))
    await sweep_once(session_module.SessionLocal)
    row = await _row(code)
    assert row.deleted_at is not None and row.deleted_reason == "expired"


async def test_token_is_bound_to_its_share_and_file(client):
    a = await _upload(client, style="count", value=3)
    b = await _upload(client, style="count", value=3)
    tok_a = (await _pickup(client, a))["url"].split("t=", 1)[1]
    assert (await client.get(f"/api/share/download/{a}?t={tok_a}")).status_code == 200
    assert (await client.get(f"/api/share/download/{b}?t={tok_a}")).status_code == 404


async def test_multi_pickup_urls_are_signed_per_file(client):
    code, _sid, file_id = await _multi(client)
    picked = await _pickup(client, code)
    url = picked["files"][0]["url"]
    assert url.startswith(f"/api/share/download/{code}/{file_id}?t=")
    res = await client.get(url)
    assert res.status_code == 200
    assert res.content == b"member file\n"
    # The member token doesn't open another file id of the same share.
    tok = url.split("t=", 1)[1]
    assert (await client.get(f"/api/share/download/{code}/{file_id + 1}?t={tok}")).status_code == 404


# ── Tokenless modes ─────────────────────────────────────────────────────────


async def test_tokenless_time_limited_share_counted_vs_all(client, monkeypatch):
    code = await _upload(client, style="day", value=1)
    assert settings.download_token_mode == "counted"
    ok = await client.get(f"/api/share/download/{code}")
    assert ok.status_code == 200

    monkeypatch.setattr(settings, "download_token_mode", "all")
    refused = await client.get(f"/api/share/download/{code}")
    assert refused.status_code == 404
    # A pickup URL still works in "all" mode.
    picked = await _pickup(client, code)
    assert (await client.get(picked["url"])).status_code == 200


async def test_tokenless_count_limited_share_is_refused(client):
    code = await _upload(client, style="count", value=5)
    assert (await client.get(f"/api/share/download/{code}")).status_code == 404
    # Refusal didn't spend anything.
    row = await _row(code)
    assert row.expired_count == 5 and row.used_count == 0


async def test_deleted_share_token_url_is_404(client):
    code = await _upload(client, style="count", value=2)
    url = (await _pickup(client, code))["url"]
    assert (await client.get(url)).status_code == 200

    token = await admin_login(client)
    row = await _row(code)
    res = await client.delete(f"/api/admin/file/{row.id}", headers=admin_headers(token))
    assert res.status_code == 200, res.text
    assert (await client.get(url)).status_code == 404


# ── Unfinalized multi shares ────────────────────────────────────────────────


async def test_unfinalized_multi_pickup_is_free_and_never_bans(client):
    code, _sid, file_id = await _multi(client, finalize=False)
    for _ in range(settings.rate_limit_retrieve_fails_per_hour + 5):
        res = await client.post("/api/share/select", json={"code": code})
        assert res.status_code == 404, res.text
        assert res.json()["detail"]["message"] == "share_not_finalized"
    row = await _row(code)
    assert row.expired_count == 1
    assert row.used_count == 0
    assert row.last_pickup_at is None

    # Even a validly signed member URL can't fetch a file early.
    tok = mint_download_token(row.id, code, file_id)
    res = await client.get(f"/api/share/download/{code}/{file_id}?t={tok}")
    assert res.status_code == 404


# ── Rate limit ──────────────────────────────────────────────────────────────


async def test_download_route_is_rate_limited_per_ip(client, monkeypatch):
    code = await _upload(client)
    monkeypatch.setattr(settings, "rate_limit_download_per_min", 3)
    for _ in range(3):
        assert (await client.get(f"/api/share/download/{code}")).status_code == 200
    limited = await client.get(f"/api/share/download/{code}")
    assert limited.status_code == 429
    assert limited.json()["code"] == 4291

    # Signed URLs draw from their own, larger bucket.
    url = (await _pickup(client, code))["url"]
    assert (await client.get(url)).status_code == 200
