"""Local filesystem storage backend.

Layout under ``settings.local_storage_dir``::

    <root>/
        share/2026/05/12/<uuid>/<sanitized-name>     ← final objects
        tmp/<upload_id>/part_<N>                     ← multipart staging

``get_object_url`` returns an internal token-protected URL (handled by the
share router); the token simply embeds ``code=…&key=…`` and is verified there.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import IO, Any
from urllib.parse import quote

import aiofiles

from ..core.config import settings
from ..core.security import encode_jwt
from .base import StorageBackend

_CHUNK = 1024 * 1024  # 1 MiB stream chunk


class LocalStorage(StorageBackend):
    """Filesystem-backed storage. Safe for single-host deploys."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.tmp_root = self.root / "tmp"
        self.root.mkdir(parents=True, exist_ok=True)
        self.tmp_root.mkdir(parents=True, exist_ok=True)

    # ── Path helpers ───────────────────────────────────────────────────────

    def _abs(self, key: str) -> Path:
        """Resolve ``key`` under ``self.root`` and refuse traversal."""
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root)):
            raise ValueError(f"refused path traversal: {key!r}")
        return p

    def _tmp_dir(self, upload_id: str) -> Path:
        d = (self.tmp_root / upload_id).resolve()
        if not str(d).startswith(str(self.tmp_root)):
            raise ValueError(f"refused tmp traversal: {upload_id!r}")
        return d

    # ── Multipart ──────────────────────────────────────────────────────────

    async def init_multipart(self, key: str, content_type: str | None = None) -> str:
        upload_id = uuid.uuid4().hex
        d = self._tmp_dir(upload_id)
        d.mkdir(parents=True, exist_ok=True)
        return upload_id

    async def sign_part(
        self,
        key: str,
        s3_upload_id: str,
        part_number: int,
        expires_in: int = 3600,
    ) -> dict[str, Any]:
        """Local backend does not use presigned URLs.

        For the local-FS path the frontend uploads parts directly to
        ``/api/chunk/upload/<upload_id>/<chunk_index>`` instead, so we return
        the internal upload URL here for symmetry. Multipart-presign is really
        only meaningful for S3-style backends.
        """
        expires_at = datetime.now(tz=UTC) + timedelta(seconds=expires_in)
        url = f"{settings.app_url.rstrip('/')}/api/chunk/upload/{s3_upload_id}/{part_number}"
        return {
            "url": url,
            "headers": {},
            "expires_at": expires_at.isoformat(),
        }

    async def complete_multipart(
        self,
        key: str,
        s3_upload_id: str,
        parts: list[dict[str, Any]],
    ) -> None:
        """Concatenate ``tmp/<upload_id>/part_*`` into the final key path."""
        src_dir = self._tmp_dir(s3_upload_id)
        if not src_dir.exists():
            raise FileNotFoundError(f"no tmp dir for upload {s3_upload_id}")
        dst = self._abs(key)
        dst.parent.mkdir(parents=True, exist_ok=True)

        def _merge() -> None:
            # parts is [{'PartNumber': n, 'ETag': ...}]; we sort by number.
            ordered = sorted(parts, key=lambda p: int(p.get("PartNumber") or p.get("part_number")))
            with open(dst, "wb") as out:
                for p in ordered:
                    n = int(p.get("PartNumber") or p.get("part_number"))
                    part_path = src_dir / f"part_{n}"
                    if not part_path.exists():
                        raise FileNotFoundError(f"missing part {n} for {s3_upload_id}")
                    with open(part_path, "rb") as src:
                        shutil.copyfileobj(src, out, _CHUNK)
            shutil.rmtree(src_dir, ignore_errors=True)

        await asyncio.to_thread(_merge)

    async def abort_multipart(self, key: str, s3_upload_id: str) -> None:
        d = self._tmp_dir(s3_upload_id)
        await asyncio.to_thread(shutil.rmtree, d, True)

    # ── Object ops ─────────────────────────────────────────────────────────

    async def head(self, key: str) -> dict[str, Any]:
        p = self._abs(key)
        if not p.exists():
            raise FileNotFoundError(key)
        st = await asyncio.to_thread(p.stat)
        return {
            "size": st.st_size,
            "content_type": None,
            "etag": f"{st.st_mtime_ns:x}-{st.st_size:x}",
        }

    async def get_object_url(
        self,
        key: str,
        ttl: int = 3600,
        response_filename: str | None = None,
    ) -> str:
        """Mint a short-lived signed URL pointing at ``/api/share/download``."""
        token = encode_jwt(
            {"key": key, "fn": response_filename or ""},
            expires_in=timedelta(seconds=ttl),
        )
        base = settings.app_url.rstrip("/")
        qfn = f"&filename={quote(response_filename)}" if response_filename else ""
        return f"{base}/api/share/download?token={token}{qfn}"

    async def server_write(self, key: str, fileobj: IO[bytes], size: int) -> None:
        p = self._abs(key)
        p.parent.mkdir(parents=True, exist_ok=True)

        def _write() -> None:
            with open(p, "wb") as out:
                shutil.copyfileobj(fileobj, out, _CHUNK)

        await asyncio.to_thread(_write)

    async def server_read(
        self,
        key: str,
        http_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]:
        p = self._abs(key)
        start, end = (http_range or (0, -1))

        async def _gen() -> AsyncIterator[bytes]:
            async with aiofiles.open(p, "rb") as f:
                if start:
                    await f.seek(start)
                remaining = (end - start + 1) if end >= 0 else None
                while True:
                    n = _CHUNK if remaining is None else min(_CHUNK, remaining)
                    if n <= 0:
                        break
                    buf = await f.read(n)
                    if not buf:
                        break
                    if remaining is not None:
                        remaining -= len(buf)
                    yield buf

        return _gen()

    async def delete(self, key: str) -> None:
        p = self._abs(key)

        def _rm() -> None:
            try:
                os.remove(p)
            except FileNotFoundError:
                pass

        await asyncio.to_thread(_rm)

    async def delete_many(self, keys: list[str]) -> None:
        for k in keys:
            try:
                await self.delete(k)
            except Exception:  # noqa: BLE001 — best-effort cleanup
                pass

    async def health(self) -> bool:
        try:
            probe = self.root / ".healthcheck"
            await asyncio.to_thread(probe.write_text, "ok")
            await asyncio.to_thread(probe.unlink)
            return True
        except Exception:
            return False
