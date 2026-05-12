"""WebDAV storage backend — stub (not implemented in v1)."""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import IO, Any

from .base import StorageBackend


class WebDAVStorage(StorageBackend):
    """Placeholder. All methods raise ``NotImplementedError``."""

    async def init_multipart(self, key: str, content_type: str | None = None) -> str:
        raise NotImplementedError("WebDAV backend not implemented")

    async def sign_part(
        self, key: str, s3_upload_id: str, part_number: int, expires_in: int = 3600
    ) -> dict[str, Any]:
        raise NotImplementedError

    async def complete_multipart(
        self, key: str, s3_upload_id: str, parts: list[dict[str, Any]]
    ) -> None:
        raise NotImplementedError

    async def abort_multipart(self, key: str, s3_upload_id: str) -> None:
        raise NotImplementedError

    async def head(self, key: str) -> dict[str, Any]:
        raise NotImplementedError

    async def get_object_url(
        self, key: str, ttl: int = 3600, response_filename: str | None = None
    ) -> str:
        raise NotImplementedError

    async def server_write(self, key: str, fileobj: IO[bytes], size: int) -> None:
        raise NotImplementedError

    async def server_read(
        self, key: str, http_range: tuple[int, int] | None = None
    ) -> AsyncIterator[bytes]:
        raise NotImplementedError

    async def delete(self, key: str) -> None:
        raise NotImplementedError

    async def health(self) -> bool:
        return False
