"""Multi-file downloads when the live storage backend cannot encrypt.

The storage backend can be switched at runtime (admin UI → settings_kv), so the
env default ``settings.storage_backend`` may still say ``local`` while the live
singleton is an S3-compatible backend that only stores plaintext. Multi-share
init used to decide "mint a DEK?" from the env value while the chunk writer
decided "encrypt?" from the live backend — the share row got a DEK, the bytes
were written in plaintext, and every download tried to decrypt and 500'd.

These tests swap in a storage wrapper that hides the encrypted read/write
methods (the S3 shape) and pin:

* init does not mint a DEK when the live backend cannot encrypt,
* files in such a share download byte-for-byte,
* rows that already carry a stale DEK over plaintext objects still download.
"""
from __future__ import annotations

from typing import Any

import pytest


class _PlaintextOnly:
    """Proxy for the real storage that hides the encryption capability."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def __getattr__(self, name: str) -> Any:
        if name in ("server_write_encrypted", "server_read_encrypted"):
            raise AttributeError(name)
        return getattr(self._inner, name)


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from app.core.rate_limit import limiter

    limiter.reset()
    yield


@pytest.fixture
def plaintext_storage(monkeypatch):
    """Make every ``get_storage()`` caller see a plaintext-only backend."""
    import app.services.chunk as chunk_mod
    import app.services.share as share_mod
    import app.services.share_multi as multi_mod
    from app.storage import get_storage

    wrapped = _PlaintextOnly(get_storage())
    for mod in (chunk_mod, share_mod, multi_mod):
        monkeypatch.setattr(mod, "get_storage", lambda: wrapped)
    # The env default still claims "local" — the stale value the old gate read.
    from app.core.config import settings

    monkeypatch.setattr(settings, "storage_backend", "local")
    return wrapped


async def _multi_share(client, files: list[tuple[str, bytes]]) -> tuple[str, int]:
    init = await client.post(
        "/api/share/multi/init",
        json={
            "declared_file_count": len(files),
            "declared_total_size": sum(len(b) for _, b in files),
            "expire_value": 1,
            "expire_style": "hour",
        },
    )
    assert init.status_code == 200, init.text
    share_id = init.json()["detail"]["share_id"]
    headers = {"Authorization": f"Bearer {init.json()['detail']['upload_token']}"}
    for name, payload in files:
        f = await client.post(
            f"/api/share/multi/{share_id}/file/init",
            headers=headers,
            json={"name": name, "size": len(payload), "declared_chunked": True, "chunk_size": 1024 * 1024},
        )
        assert f.status_code == 200, f.text
        fd = f.json()["detail"]
        part = await client.post(
            f"/api/chunk/upload/{fd['upload_id']}/0",
            files={"chunk": ("blob", payload, "application/octet-stream")},
        )
        assert part.status_code == 200, part.text
        done = await client.post(
            f"/api/share/multi/{share_id}/file/{fd['file_id']}/complete",
            headers=headers,
            json={"total_uploaded_bytes": len(payload)},
        )
        assert done.status_code == 200, done.text
    fin = await client.post(f"/api/share/multi/{share_id}/finalize", headers=headers)
    assert fin.status_code == 200, fin.text
    return fin.json()["detail"]["code"], share_id


async def _download_all(client, code: str) -> dict[str, bytes]:
    sel = await client.post("/api/share/select", json={"code": code})
    assert sel.status_code == 200, sel.text
    out: dict[str, bytes] = {}
    for f in sel.json()["detail"]["files"]:
        res = await client.get(f["url"])
        assert res.status_code == 200, res.text
        out[f["name"]] = res.content
    return out


async def test_no_dek_minted_when_live_backend_cannot_encrypt(client, plaintext_storage):
    from sqlalchemy import select

    from app.db.session import SessionLocal
    from app.models.file_code import FileCode

    code, _ = await _multi_share(client, [("a.png", b"\x89PNG fake")])
    async with SessionLocal() as db:
        row = (await db.execute(select(FileCode).where(FileCode.code == code))).scalars().first()
    assert row is not None and row.wrapped_dek is None


async def test_multi_files_download_on_plaintext_backend(client, plaintext_storage):
    files = [("a.png", b"\x89PNG fake image"), ("b.txt", b"hello\n")]
    code, _ = await _multi_share(client, files)
    assert await _download_all(client, code) == dict(files)


async def test_stale_dek_over_plaintext_objects_still_downloads(client, plaintext_storage):
    """Rows created before the fix carry a DEK their plaintext bytes never used."""
    from sqlalchemy import update

    from app.core.crypto import generate_dek, wrap_dek
    from app.db.session import SessionLocal
    from app.models.file_code import FileCode

    files = [("c.mp4", b"not really a video")]
    code, _ = await _multi_share(client, files)
    async with SessionLocal() as db:
        await db.execute(update(FileCode).where(FileCode.code == code).values(wrapped_dek=wrap_dek(generate_dek())))
        await db.commit()
    assert await _download_all(client, code) == dict(files)
