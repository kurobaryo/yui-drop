"""/api/v1 multipart upload: real expiry on complete, longer session lifetime.

Runs against moto's in-memory S3 (the presigned multipart flow only exists
on S3-compatible backends). Parts are PUT with the S3 client directly — the
same bytes a client would send to the presigned URLs.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.config import settings
from app.models.multipart_session import MultipartSession
from tests._api_helpers import issue_key, key_headers
from tests._moto_s3 import BUCKET

MiB = 1024 * 1024


async def _session(upload_id: str) -> MultipartSession:
    from app.db import session as session_module

    async with session_module.SessionLocal() as db:
        return (
            await db.execute(
                select(MultipartSession).where(MultipartSession.upload_id == upload_id)
            )
        ).scalar_one()


async def _upload_parts(storage, sess: MultipartSession, data: bytes, part_size: int) -> list[dict]:
    parts = []
    async with storage._client() as s3:
        for i in range(0, len(data), part_size):
            n = i // part_size + 1
            res = await s3.upload_part(
                Bucket=BUCKET, Key=sess.key, UploadId=sess.s3_upload_id,
                PartNumber=n, Body=data[i : i + part_size],
            )
            parts.append({"part_number": n, "etag": res["ETag"]})
    return parts


def _close_to(iso: str, expected: datetime, slack: timedelta = timedelta(minutes=1)) -> bool:
    got = datetime.fromisoformat(iso)
    if got.tzinfo is None:
        got = got.replace(tzinfo=UTC)
    return abs(got - expected) <= slack


async def _run_upload(client, s3_storage, plaintext: str, *, value: int, style: str) -> dict:
    data = b"x" * (5 * MiB) + b"tail"
    init = await client.post(
        "/api/v1/upload/init",
        headers=key_headers(plaintext),
        json={"file_name": "big.bin", "file_size": len(data),
              "expire_value": value, "expire_style": style},
    )
    assert init.status_code == 200, init.text
    d = init.json()["detail"]
    sess = await _session(d["upload_id"])
    parts = await _upload_parts(s3_storage, sess, data, d["part_size"])
    done = await client.post(
        f"/api/v1/upload/{d['upload_id']}/complete",
        headers=key_headers(plaintext),
        json={"parts": parts},
    )
    assert done.status_code == 200, done.text
    return {"init": d, "complete": done.json()["detail"]}


async def test_complete_returns_real_time_expiry(client, s3_storage):
    plaintext, _r, _t = await issue_key(client, max_file_size=100 * MiB)
    out = await _run_upload(client, s3_storage, plaintext, value=7, style="day")
    done = out["complete"]
    assert done["expired_count"] == -1
    assert done["expired_at"] is not None
    assert _close_to(done["expired_at"], datetime.now(tz=UTC) + timedelta(days=7))
    # And it matches what the share list reports.
    listed = await client.get(f"/api/v1/shares/{done['code']}", headers=key_headers(plaintext))
    assert _close_to(
        listed.json()["detail"]["expired_at"],
        datetime.fromisoformat(done["expired_at"]),
        timedelta(seconds=1),
    )


async def test_complete_returns_real_count_expiry(client, s3_storage):
    plaintext, _r, _t = await issue_key(client, max_file_size=100 * MiB)
    done = (await _run_upload(client, s3_storage, plaintext, value=3, style="count"))["complete"]
    assert done["expired_count"] == 3
    assert done["expired_at"] is None


async def test_v1_session_lives_360_minutes(client, s3_storage):
    plaintext, _r, _t = await issue_key(client, max_file_size=100 * MiB)
    res = await client.post(
        "/api/v1/upload/init",
        headers=key_headers(plaintext),
        json={"file_name": "big.bin", "file_size": 6 * MiB},
    )
    assert res.status_code == 200, res.text
    assert settings.v1_multipart_session_ttl_min == 360
    assert _close_to(
        res.json()["detail"]["expires_at"], datetime.now(tz=UTC) + timedelta(minutes=360)
    )


async def test_anonymous_session_keeps_60_minutes(client, s3_storage):
    from app.core.rate_limit import limiter

    limiter.reset()
    res = await client.post(
        "/api/presign/init",
        json={"file_name": "big.bin", "file_size": 6 * MiB},
    )
    assert res.status_code == 200, res.text
    assert _close_to(
        res.json()["detail"]["expires_at"],
        datetime.now(tz=UTC) + timedelta(minutes=settings.multipart_session_ttl_min),
    )
