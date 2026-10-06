"""/api/v1 multi-file share: create → files → parts → complete → finalize / abort.

Most tests run on moto's in-memory S3 — the production path, where parts are
relayed to the bucket with server-side UploadPart. One test covers the local
backend (staged parts, encrypted at rest).
"""
from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.rate_limit import limiter, retrieve_fail_tracker
from app.models.file_code import FileCode
from app.models.share_file import ShareFile
from app.services.v1_multi import PART_SIZE
from tests._api_helpers import issue_key, key_headers
from tests._moto_s3 import list_keys, open_multipart_uploads

MiB = 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")

BIG = bytes(range(256)) * (PART_SIZE // 256) + b"tail-bytes"  # 2 parts
SMALL_A = b"alpha file\n"
SMALL_B = b"%PDF-1.4 beta\n"
FILES = [("big.bin", BIG), ("a.txt", SMALL_A), ("b.pdf", SMALL_B)]
NOTE = "Three files for you.\n三个文件"


@pytest.fixture(autouse=True)
async def _clean_limits():
    limiter.reset()
    await retrieve_fail_tracker.reset()
    yield
    await retrieve_fail_tracker.reset()


def _db():
    from app.db import session as session_module

    return session_module.SessionLocal()


def _path(url: str) -> str:
    """Absolute v1 URL → path + query for the in-process test client."""
    parts = urlsplit(url)
    return f"{parts.path}?{parts.query}"


def _env(res) -> dict[str, Any]:
    body = res.json().get("detail") or {}
    return body if isinstance(body, dict) else {}


async def _key(client, **kw) -> str:
    kw.setdefault("max_file_size", 100 * MiB)
    plaintext, _r, _t = await issue_key(client, scopes=["upload", "read"], **kw)
    return plaintext


async def _create(client, key: str, *, files=FILES, text: str | None = NOTE,
                  style: str = "day", value: int = 7) -> dict:
    body: dict[str, Any] = {
        "declared_file_count": len(files),
        "declared_total_size": sum(len(b) for _, b in files),
        "expire_value": value,
        "expire_style": style,
    }
    if text is not None:
        body["text"] = text
    res = await client.post("/api/v1/share/multi", headers=key_headers(key), json=body)
    assert res.status_code == 200, res.text
    return res.json()["detail"]


async def _add_file(client, key: str, share_id: str, name: str, data: bytes) -> dict:
    res = await client.post(
        f"/api/v1/share/multi/{share_id}/files",
        headers=key_headers(key),
        json={"name": name, "size": len(data), "content_type": "application/octet-stream"},
    )
    assert res.status_code == 200, res.text
    return res.json()["detail"]


async def _put_parts(client, key: str, share_id: str, f: dict, data: bytes) -> list[dict]:
    parts = []
    for n in range(1, f["parts_total"] + 1):
        chunk = data[(n - 1) * f["part_size"] : n * f["part_size"]]
        res = await client.post(
            f"/api/v1/share/multi/{share_id}/files/{f['file_id']}/parts/{n}",
            headers=key_headers(key),
            files={"chunk": ("blob", chunk, "application/octet-stream")},
        )
        assert res.status_code == 200, res.text
        parts.append(res.json()["detail"])
    return parts


async def _complete(client, key: str, share_id: str, f: dict, parts: list[dict]):
    return await client.post(
        f"/api/v1/share/multi/{share_id}/files/{f['file_id']}/complete",
        headers=key_headers(key),
        json={"parts": parts},
    )


async def _upload_all(client, key: str, share_id: str, files=FILES) -> list[dict]:
    out = []
    for name, data in files:
        f = await _add_file(client, key, share_id, name, data)
        parts = await _put_parts(client, key, share_id, f, data)
        done = await _complete(client, key, share_id, f, parts)
        assert done.status_code == 200, done.text
        assert done.json()["detail"] == {"file_id": f["file_id"], "name": name, "size": len(data)}
        out.append(f)
    return out


async def _finalize(client, key: str, share_id: str):
    return await client.post(f"/api/v1/share/multi/{share_id}/finalize", headers=key_headers(key))


async def _row(code: str) -> FileCode | None:
    async with _db() as db:
        return (await db.execute(select(FileCode).where(FileCode.code == code))).scalars().first()


# ── Happy path ──────────────────────────────────────────────────────────────


async def test_three_files_and_note_round_trip(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key)
    share_id, code = created["share_id"], created["code"]
    assert isinstance(share_id, str) and ID_RE.match(share_id)
    assert created["expired_count"] == -1 and created["expired_at"]

    files = await _upload_all(client, key, share_id)
    big = files[0]
    assert ID_RE.match(big["file_id"])
    assert big["part_size"] == PART_SIZE == 6291456
    assert big["parts_total"] == 2
    assert files[1]["part_size"] == len(SMALL_A) and files[1]["parts_total"] == 1
    # S3 relay → every part has an ETag; nothing left half-open.
    assert await open_multipart_uploads(s3_storage) == []

    fin = await _finalize(client, key, share_id)
    assert fin.status_code == 200, fin.text
    entry = fin.json()["detail"]
    assert entry["kind"] == "multi"
    assert entry["code"] == code
    assert entry["name"] is None and entry["size"] is None
    assert entry["file_count"] == 3
    assert entry["total_size"] == sum(len(b) for _, b in FILES)
    assert entry["has_note"] is True
    assert entry["url"] is None
    assert entry["used_count"] == 0 and entry["expired_count"] == -1
    exp = datetime.fromisoformat(entry["expired_at"])
    assert abs(exp - (datetime.now(tz=UTC) + timedelta(days=7))) < timedelta(minutes=1)
    assert entry["short_url"].endswith(f"/s/{code}")

    # Same entry in the list and the detail.
    listed = await client.get("/api/v1/shares", headers=key_headers(key))
    row = next(i for i in listed.json()["detail"]["items"] if i["code"] == code)
    assert row["file_count"] == 3 and row["has_note"] is True and row["url"] is None
    assert row["total_size"] == entry["total_size"]
    detail = await client.get(f"/api/v1/shares/{code}", headers=key_headers(key))
    assert detail.json()["detail"]["file_count"] == 3

    # Pickup: three absolute, signed URLs plus the note; bytes round-trip.
    picked = await client.post("/api/v1/pickup", headers=key_headers(key), json={"code": code})
    assert picked.status_code == 200, picked.text
    p = picked.json()["detail"]
    assert p["kind"] == "multi" and p["text"] == NOTE and p["file_count"] == 3
    assert [f["name"] for f in p["files"]] == [n for n, _ in FILES]
    for f, (_name, data) in zip(p["files"], FILES, strict=True):
        assert f["url"].startswith("http") and "?t=" in f["url"]
        got = await client.get(_path(f["url"]))
        assert got.status_code == 200, got.text
        assert got.content == data


async def test_finalize_is_idempotent(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key, style="count", value=1)
    await _upload_all(client, key, created["share_id"], files=FILES[1:])
    first = await _finalize(client, key, created["share_id"])
    second = await _finalize(client, key, created["share_id"])
    assert first.status_code == second.status_code == 200
    a, b = first.json()["detail"], second.json()["detail"]
    assert {k: v for k, v in a.items() if k != "url"} == {k: v for k, v in b.items() if k != "url"}
    assert b["expired_count"] == 1 and b["used_count"] == 0


async def test_expiry_clock_starts_at_finalize(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key, files=FILES[1:2], style="hour", value=1)
    await _upload_all(client, key, created["share_id"], files=FILES[1:2])
    # Pretend the upload took 50 minutes.
    async with _db() as db:
        row = (await db.execute(select(FileCode).where(FileCode.code == created["code"]))).scalar_one()
        row.created_at = row.created_at - timedelta(minutes=50)
        row.expired_at = row.expired_at - timedelta(minutes=50)
        await db.commit()
    entry = (await _finalize(client, key, created["share_id"])).json()["detail"]
    exp = datetime.fromisoformat(entry["expired_at"])
    assert abs(exp - (datetime.now(tz=UTC) + timedelta(hours=1))) < timedelta(minutes=1)


# ── Before finalize ─────────────────────────────────────────────────────────


async def test_unfinalized_pickup_is_free_and_never_bans(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key, files=FILES[1:2], style="count", value=1)
    code = created["code"]
    files = await _upload_all(client, key, created["share_id"], files=FILES[1:2])

    for _ in range(25):
        res = await client.post("/api/v1/pickup", headers=key_headers(key), json={"code": code})
        assert res.status_code == 404
        assert _env(res)["message"] == "share_not_finalized"
        anon = await client.post("/api/share/select", json={"code": code})
        assert anon.status_code == 404
    # Completed file of an unfinalized share is not downloadable.
    dl = await client.get(f"/api/share/download/{code}/{files[0]['file_id']}")
    assert dl.status_code == 404

    # Not listed while open.
    listed = await client.get("/api/v1/shares?status=all", headers=key_headers(key))
    assert code not in [i["code"] for i in listed.json()["detail"]["items"]]

    assert (await _finalize(client, key, created["share_id"])).status_code == 200
    row = await _row(code)
    assert row.expired_count == 1 and row.used_count == 0
    ok = await client.post("/api/v1/pickup", headers=key_headers(key), json={"code": code})
    assert ok.status_code == 200, "the single pickup must still be available"


async def test_finalize_requires_every_file_complete(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key, files=FILES[1:])
    sid = created["share_id"]
    assert (await _finalize(client, key, sid)).status_code == 409  # no files yet
    f = await _add_file(client, key, sid, "a.txt", SMALL_A)
    await _put_parts(client, key, sid, f, SMALL_A)
    res = await _finalize(client, key, sid)
    assert res.status_code == 409
    assert _env(res)["message"] == "incomplete_files"


# ── Ownership ───────────────────────────────────────────────────────────────


async def test_other_keys_get_404_on_every_step(client, s3_storage):
    owner, _r, admin = await issue_key(client, scopes=["upload", "read"], max_file_size=100 * MiB)
    other, _r2, _t = await issue_key(client, admin_token=admin, scopes=["upload", "read"])
    created = await _create(client, owner, files=FILES[1:2])
    sid = created["share_id"]
    f = await _add_file(client, owner, sid, "a.txt", SMALL_A)
    h = key_headers(other)
    base = f"/api/v1/share/multi/{sid}"
    attempts = [
        await client.post(f"{base}/files", headers=h, json={"name": "x", "size": 1}),
        await client.post(
            f"{base}/files/{f['file_id']}/parts/1", headers=h,
            files={"chunk": ("blob", SMALL_A, "application/octet-stream")},
        ),
        await client.post(
            f"{base}/files/{f['file_id']}/complete", headers=h,
            json={"parts": [{"part_number": 1, "etag": None}]},
        ),
        await client.post(f"{base}/finalize", headers=h),
        await client.delete(base, headers=h),
    ]
    for res in attempts:
        assert res.status_code == 404, res.text
        assert _env(res)["message"] == "share_not_found"
    unknown = await client.post("/api/v1/share/multi/999999/finalize", headers=h)
    assert unknown.content == attempts[3].content

    # The owner's upload is unaffected.
    parts = await _put_parts(client, owner, sid, f, SMALL_A)
    assert (await _complete(client, owner, sid, f, parts)).status_code == 200


# ── Abort ───────────────────────────────────────────────────────────────────


async def test_abort_cleans_storage_and_releases_code(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key)
    sid, code = created["share_id"], created["code"]
    # One file complete, one half-uploaded, one only declared.
    done = await _add_file(client, key, sid, "a.txt", SMALL_A)
    await _complete(client, key, sid, done, await _put_parts(client, key, sid, done, SMALL_A))
    half = await _add_file(client, key, sid, "big.bin", BIG)
    first = BIG[:PART_SIZE]
    res = await client.post(
        f"/api/v1/share/multi/{sid}/files/{half['file_id']}/parts/1",
        headers=key_headers(key),
        files={"chunk": ("blob", first, "application/octet-stream")},
    )
    assert res.status_code == 200 and res.json()["detail"]["etag"]
    await _add_file(client, key, sid, "b.pdf", SMALL_B)
    assert await list_keys(s3_storage)
    assert await open_multipart_uploads(s3_storage)

    res = await client.delete(f"/api/v1/share/multi/{sid}", headers=key_headers(key))
    assert res.status_code == 200, res.text
    assert res.json()["detail"] == {"share_id": sid, "aborted": True}

    assert await list_keys(s3_storage) == []
    assert await open_multipart_uploads(s3_storage) == []
    assert await _row(code) is None, "code must be released"
    async with _db() as db:
        assert (await db.execute(select(ShareFile))).scalars().all() == []
    pick = await client.post("/api/v1/pickup", headers=key_headers(key), json={"code": code})
    assert pick.status_code == 404 and _env(pick)["message"] == "code_not_found"
    again = await client.delete(f"/api/v1/share/multi/{sid}", headers=key_headers(key))
    assert again.status_code == 404 and _env(again)["message"] == "share_not_found"


async def test_abort_after_finalize_is_revoke(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key, files=FILES[1:])
    sid, code = created["share_id"], created["code"]
    await _upload_all(client, key, sid, files=FILES[1:])
    assert (await _finalize(client, key, sid)).status_code == 200
    picked = (await client.post("/api/share/select", json={"code": code})).json()["detail"]
    url = picked["files"][0]["url"]
    assert (await client.get(url)).status_code == 200

    res = await client.delete(f"/api/v1/share/multi/{sid}", headers=key_headers(key))
    assert res.status_code == 200
    assert res.json()["detail"] == {"share_id": sid, "aborted": True}

    assert (await client.post("/api/share/select", json={"code": code})).status_code == 404
    assert (await client.get(url)).status_code == 404
    row = await _row(code)
    assert row.deleted_at is not None and row.deleted_reason == "revoked"


async def test_revoke_route_on_multi_share(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key, files=FILES[1:2])
    await _upload_all(client, key, created["share_id"], files=FILES[1:2])
    await _finalize(client, key, created["share_id"])
    res = await client.delete(f"/api/v1/shares/{created['code']}", headers=key_headers(key))
    assert res.status_code == 200
    assert (await client.post("/api/share/select", json={"code": created["code"]})).status_code == 404


async def test_sweeper_reaps_unfinalized_share_after_session_ttl(client, s3_storage):
    from app.db import session as session_module
    from app.services.retention import sweep_once

    key = await _key(client)
    created = await _create(client, key, files=FILES[:2], style="hour", value=1)
    sid, code = created["share_id"], created["code"]
    done = await _add_file(client, key, sid, "a.txt", SMALL_A)
    await _complete(client, key, sid, done, await _put_parts(client, key, sid, done, SMALL_A))
    await _add_file(client, key, sid, "big.bin", BIG)  # open MPU

    # Within the TTL — even past the share's own (provisional) expiry — kept.
    async with _db() as db:
        row = (await db.execute(select(FileCode).where(FileCode.code == code))).scalar_one()
        row.created_at = row.created_at - timedelta(minutes=120)
        await db.commit()
    await sweep_once(session_module.SessionLocal)
    row = await _row(code)
    assert row is not None and row.deleted_at is None

    async with _db() as db:
        row = (await db.execute(select(FileCode).where(FileCode.code == code))).scalar_one()
        row.created_at = row.created_at - timedelta(minutes=settings.v1_multipart_session_ttl_min)
        await db.commit()
    # Past the session deadline the share no longer accepts work…
    late = await _finalize(client, key, sid)
    assert late.status_code == 410
    # …and the sweeper discards it.
    await sweep_once(session_module.SessionLocal)
    assert await _row(code) is None
    assert await list_keys(s3_storage) == []
    assert await open_multipart_uploads(s3_storage) == []


# ── Limits and validation ───────────────────────────────────────────────────


async def test_note_rules(client, s3_storage):
    key = await _key(client)
    blank = await _create(client, key, files=FILES[1:2], text="  \n\t ")
    await _upload_all(client, key, blank["share_id"], files=FILES[1:2])
    entry = (await _finalize(client, key, blank["share_id"])).json()["detail"]
    assert entry["has_note"] is False

    # 262144 bytes is fine, one more byte (here: one 3-byte char over) is not.
    exact = "a" * settings.max_text_bytes
    ok = await client.post(
        "/api/v1/share/multi", headers=key_headers(key),
        json={"declared_file_count": 1, "declared_total_size": 1, "text": exact},
    )
    assert ok.status_code == 200
    over = "a" * (settings.max_text_bytes - 2) + "字"
    res = await client.post(
        "/api/v1/share/multi", headers=key_headers(key),
        json={"declared_file_count": 1, "declared_total_size": 1, "text": over},
    )
    assert res.status_code == 413 and _env(res)["message"] == "text_too_large"


async def test_declared_limits(client, s3_storage):
    key = await _key(client)
    too_many = await client.post(
        "/api/v1/share/multi", headers=key_headers(key),
        json={"declared_file_count": 201, "declared_total_size": 1},
    )
    assert too_many.status_code == 400 and _env(too_many)["message"] == "share_file_count_exceeded"
    too_big = await client.post(
        "/api/v1/share/multi", headers=key_headers(key),
        json={"declared_file_count": 1, "declared_total_size": 10 * 1024**3 + 1},
    )
    assert too_big.status_code == 400 and _env(too_big)["message"] == "share_quota_exceeded"
    zero = await client.post(
        "/api/v1/share/multi", headers=key_headers(key),
        json={"declared_file_count": 0, "declared_total_size": 1},
    )
    assert zero.status_code == 422


async def test_per_file_and_total_caps(client, s3_storage, monkeypatch):
    key = await _key(client)
    created = await _create(client, key, files=FILES[1:])
    sid = created["share_id"]
    monkeypatch.setattr(settings, "max_file_bytes", 8)
    res = await client.post(
        f"/api/v1/share/multi/{sid}/files", headers=key_headers(key),
        json={"name": "a.txt", "size": 9},
    )
    assert res.status_code == 413 and _env(res)["message"] == "file_too_large"
    monkeypatch.setattr(settings, "max_file_bytes", 10 * 1024**3)
    monkeypatch.setattr(settings, "max_share_total_bytes", 20)
    await _add_file(client, key, sid, "a.txt", b"x" * 15)
    res = await client.post(
        f"/api/v1/share/multi/{sid}/files", headers=key_headers(key),
        json={"name": "b.txt", "size": 6},
    )
    assert res.status_code == 400 and _env(res)["message"] == "share_quota_exceeded"


async def test_key_quota_applies_per_file(client, s3_storage):
    key = await _key(client, max_file_size=16)
    created = await _create(client, key, files=FILES[1:])
    res = await client.post(
        f"/api/v1/share/multi/{created['share_id']}/files", headers=key_headers(key),
        json={"name": "a.txt", "size": 17},
    )
    assert res.status_code == 413 and _env(res)["code"] == 4293
    ok = await client.post(
        f"/api/v1/share/multi/{created['share_id']}/files", headers=key_headers(key),
        json={"name": "a.txt", "size": 16},
    )
    assert ok.status_code == 200


async def test_part_validation(client, s3_storage):
    key = await _key(client)
    created = await _create(client, key, files=FILES[:1])
    sid = created["share_id"]
    f = await _add_file(client, key, sid, "big.bin", BIG)
    url = f"/api/v1/share/multi/{sid}/files/{f['file_id']}/parts"
    h = key_headers(key)
    short = await client.post(f"{url}/1", headers=h, files={"chunk": ("b", b"x" * 10, "x/y")})
    assert short.status_code == 400 and _env(short)["message"] == "invalid_part_size"
    beyond = await client.post(f"{url}/3", headers=h, files={"chunk": ("b", b"x", "x/y")})
    assert beyond.status_code == 400 and _env(beyond)["message"] == "invalid_part_number"
    huge = await client.post(
        f"{url}/1", headers=h, files={"chunk": ("b", b"x" * (PART_SIZE + 1), "x/y")}
    )
    assert huge.status_code == 400
    no_field = await client.post(f"{url}/1", headers=h, files={"other": ("b", b"x", "x/y")})
    assert no_field.status_code == 400 and _env(no_field)["message"] == "chunk_required"
    bad_id = await client.post(f"/api/v1/share/multi/{sid}/files/abc/parts/1", headers=h,
                               files={"chunk": ("b", b"x", "x/y")})
    assert bad_id.status_code == 404

    # Completing with a missing part is refused; the bucket is the referee.
    p1 = await client.post(f"{url}/1", headers=h,
                           files={"chunk": ("b", BIG[:PART_SIZE], "x/y")})
    res = await _complete(client, key, sid, f, [p1.json()["detail"], {"part_number": 2, "etag": None}])
    assert res.status_code == 400 and _env(res)["message"] == "missing_parts"
    wrong = await _complete(client, key, sid, f, [p1.json()["detail"]])
    assert wrong.status_code == 400 and _env(wrong)["message"] == "parts_count_mismatch"


# ── Local backend ───────────────────────────────────────────────────────────


async def test_local_backend_flow_is_encrypted_at_rest(client):
    from app.storage import get_storage

    storage = get_storage()
    assert hasattr(storage, "server_write_encrypted"), "tests default to the local backend"
    key = await _key(client)
    created = await _create(client, key, files=FILES[:2])
    sid, code = created["share_id"], created["code"]
    files = []
    for name, data in FILES[:2]:
        f = await _add_file(client, key, sid, name, data)
        parts = await _put_parts(client, key, sid, f, data)
        assert all(p["etag"] is None for p in parts)
        done = await _complete(client, key, sid, f, parts)
        assert done.status_code == 200, done.text
        files.append(f)
    assert (await _finalize(client, key, sid)).status_code == 200

    async with _db() as db:
        sf = (await db.execute(select(ShareFile).where(ShareFile.id == int(files[1]["file_id"])))).scalar_one()
    on_disk = storage._abs(sf.file_path).read_bytes()
    assert SMALL_A not in on_disk

    picked = (await client.post("/api/share/select", json={"code": code})).json()["detail"]
    for f, (_n, data) in zip(picked["files"], FILES[:2], strict=True):
        got = await client.get(f["url"])
        assert got.status_code == 200 and got.content == data
