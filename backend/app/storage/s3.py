"""S3 (and S3-compatible: R2, MinIO, ...) storage backend.

Uses ``aioboto3`` so all calls are non-blocking. The client session is created
lazily on first use and cached per-instance — boto's session itself is *not*
safe to share across event loops but we only ever run one.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import IO, Any

import aioboto3
from botocore.config import Config as BotoConfig

from .base import StorageBackend


class S3Storage(StorageBackend):
    """S3-compatible multipart-aware backend."""

    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        region: str = "auto",
        public_hostname: str | None = None,
    ) -> None:
        self.bucket = bucket
        self.endpoint_url = endpoint_url or None
        self.region = region or "auto"
        self.public_hostname = public_hostname or None
        self._access_key = access_key or None
        self._secret_key = secret_key or None
        # aioboto3 sessions are cheap; we keep one for the lifetime of the
        # process and acquire a fresh client per call (its async context
        # manager is the supported usage pattern).
        self._session = aioboto3.Session()

    def _client(self):
        cfg = BotoConfig(signature_version="s3v4", s3={"addressing_style": "virtual"})
        return self._session.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
            region_name=self.region if self.region != "auto" else None,
            config=cfg,
        )

    # ── Multipart ──────────────────────────────────────────────────────────

    async def init_multipart(self, key: str, content_type: str | None = None) -> str:
        kwargs: dict[str, Any] = {"Bucket": self.bucket, "Key": key}
        if content_type:
            kwargs["ContentType"] = content_type
        async with self._client() as s3:
            resp = await s3.create_multipart_upload(**kwargs)
        return resp["UploadId"]

    async def sign_part(
        self,
        key: str,
        s3_upload_id: str,
        part_number: int,
        expires_in: int = 3600,
    ) -> dict[str, Any]:
        async with self._client() as s3:
            url = await s3.generate_presigned_url(
                ClientMethod="upload_part",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "UploadId": s3_upload_id,
                    "PartNumber": part_number,
                },
                ExpiresIn=expires_in,
                HttpMethod="PUT",
            )
        expires_at = datetime.now(tz=UTC) + timedelta(seconds=expires_in)
        return {
            "url": url,
            "headers": {},  # client sets Content-Length on PUT
            "expires_at": expires_at.isoformat(),
        }

    async def complete_multipart(
        self,
        key: str,
        s3_upload_id: str,
        parts: list[dict[str, Any]],
    ) -> None:
        # Normalize -> [{"PartNumber": int, "ETag": str}] sorted by part number.
        normalized = sorted(
            [
                {
                    "PartNumber": int(p.get("PartNumber") or p.get("part_number")),
                    "ETag": p.get("ETag") or p.get("etag"),
                }
                for p in parts
            ],
            key=lambda x: x["PartNumber"],
        )
        async with self._client() as s3:
            await s3.complete_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=s3_upload_id,
                MultipartUpload={"Parts": normalized},
            )

    async def abort_multipart(self, key: str, s3_upload_id: str) -> None:
        async with self._client() as s3:
            try:
                await s3.abort_multipart_upload(
                    Bucket=self.bucket, Key=key, UploadId=s3_upload_id
                )
            except Exception:  # already aborted / expired — treat as success
                pass

    # ── Object ops ─────────────────────────────────────────────────────────

    async def head(self, key: str) -> dict[str, Any]:
        async with self._client() as s3:
            resp = await s3.head_object(Bucket=self.bucket, Key=key)
        return {
            "size": int(resp.get("ContentLength") or 0),
            "content_type": resp.get("ContentType"),
            "etag": (resp.get("ETag") or "").strip('"'),
        }

    async def get_object_url(
        self,
        key: str,
        ttl: int = 3600,
        response_filename: str | None = None,
    ) -> str:
        params: dict[str, Any] = {"Bucket": self.bucket, "Key": key}
        if response_filename:
            from urllib.parse import quote as _q

            params["ResponseContentDisposition"] = (
                f'attachment; filename="{response_filename}"; '
                f"filename*=UTF-8''{_q(response_filename)}"
            )
        async with self._client() as s3:
            url = await s3.generate_presigned_url(
                "get_object", Params=params, ExpiresIn=ttl
            )
        return url

    async def server_write(self, key: str, fileobj: IO[bytes], size: int) -> None:
        async with self._client() as s3:
            await s3.put_object(Bucket=self.bucket, Key=key, Body=fileobj)

    async def server_read(
        self,
        key: str,
        http_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]:
        get_kwargs: dict[str, Any] = {"Bucket": self.bucket, "Key": key}
        if http_range:
            start, end = http_range
            get_kwargs["Range"] = f"bytes={start}-{end if end >= 0 else ''}"

        async def _gen() -> AsyncIterator[bytes]:
            async with self._client() as s3:
                resp = await s3.get_object(**get_kwargs)
                body = resp["Body"]
                try:
                    async for chunk in body.iter_chunks(chunk_size=1024 * 1024):
                        yield chunk
                finally:
                    body.close()

        return _gen()

    async def delete(self, key: str) -> None:
        async with self._client() as s3:
            try:
                await s3.delete_object(Bucket=self.bucket, Key=key)
            except Exception:
                pass

    async def delete_many(self, keys: list[str]) -> None:
        if not keys:
            return
        # S3 DeleteObjects accepts up to 1000 keys per call.
        async with self._client() as s3:
            for i in range(0, len(keys), 1000):
                batch = keys[i : i + 1000]
                try:
                    await s3.delete_objects(
                        Bucket=self.bucket,
                        Delete={
                            "Objects": [{"Key": k} for k in batch],
                            "Quiet": True,
                        },
                    )
                except Exception:  # noqa: BLE001 — best-effort
                    pass

    async def health(self) -> bool:
        try:
            async with self._client() as s3:
                await s3.head_bucket(Bucket=self.bucket)
            return True
        except Exception:
            return False
