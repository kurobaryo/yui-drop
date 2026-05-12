"""Storage backend Protocol.

Every backend (local FS, S3, OneDrive, WebDAV) implements this contract so
service code never branches on backend type.

Notes
-----
* ``key`` is the *logical* object key (e.g.
  ``share/2026/05/12/<uuid>/<sanitized-name>``). Backends are free to map it to
  whatever underlying path/blob name they need.
* ``init_multipart`` returns the upstream-provider's multipart-id (S3 UploadId
  for S3; for local FS, a synthetic id used to namespace the tmp dir).
* ``get_object_url`` returns whatever URL the client should hit to download:
  for S3 a presigned GET, for local FS a token-protected internal URL.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import IO, Any, Protocol, runtime_checkable


@runtime_checkable
class StorageBackend(Protocol):
    """Backend contract — see module docstring."""

    # ── Multipart upload (used by /api/presign/*) ──────────────────────────

    async def init_multipart(self, key: str, content_type: str | None = None) -> str:
        """Open an upstream multipart upload. Returns the provider's upload id."""
        ...

    async def sign_part(
        self,
        key: str,
        s3_upload_id: str,
        part_number: int,
        expires_in: int = 3600,
    ) -> dict[str, Any]:
        """Return ``{url, headers, expires_at}`` for a single part PUT."""
        ...

    async def complete_multipart(
        self,
        key: str,
        s3_upload_id: str,
        parts: list[dict[str, Any]],
    ) -> None:
        """Finalize a multipart upload. ``parts`` = ``[{PartNumber, ETag}]``."""
        ...

    async def abort_multipart(self, key: str, s3_upload_id: str) -> None:
        """Abort an in-progress multipart upload + reap server-side state."""
        ...

    # ── Object operations ──────────────────────────────────────────────────

    async def head(self, key: str) -> dict[str, Any]:
        """Return ``{size, content_type, etag}`` for an existing object."""
        ...

    async def get_object_url(
        self,
        key: str,
        ttl: int = 3600,
        response_filename: str | None = None,
    ) -> str:
        """Return a URL the client can use to download ``key``."""
        ...

    async def server_write(self, key: str, fileobj: IO[bytes], size: int) -> None:
        """Server-side write of a single blob (used by chunk-merge + simple upload)."""
        ...

    async def server_read(
        self,
        key: str,
        http_range: tuple[int, int] | None = None,
    ) -> AsyncIterator[bytes]:
        """Async iterator over bytes (whole object or HTTP range)."""
        ...

    async def delete(self, key: str) -> None:
        """Delete an object. No-op if it doesn't exist."""
        ...

    async def delete_many(self, keys: list[str]) -> None:
        """Delete multiple objects. Default impl calls ``delete`` per key.

        Backends with a native bulk-delete API (S3 ``DeleteObjects``) should
        override for fewer round-trips.
        """
        ...

    async def health(self) -> bool:
        """Cheap reachability probe."""
        ...
