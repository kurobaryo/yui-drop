"""Storage backend factory.

Returns a process-wide singleton instance keyed off ``settings.storage_backend``.
The instance is created lazily on first call.
"""
from __future__ import annotations

import threading

from ..core.config import settings
from .base import StorageBackend

_instance: StorageBackend | None = None
_lock = threading.Lock()


def get_storage() -> StorageBackend:
    """Return the configured storage backend (singleton)."""
    global _instance
    if _instance is not None:
        return _instance
    with _lock:
        if _instance is not None:
            return _instance
        backend = settings.storage_backend
        if backend == "local":
            from .local import LocalStorage

            _instance = LocalStorage(settings.local_storage_dir)
        elif backend == "s3":
            from .s3 import S3Storage

            _instance = S3Storage(
                bucket=settings.s3_bucket_name,
                endpoint_url=settings.s3_endpoint_url or None,
                access_key=settings.s3_access_key_id or None,
                secret_key=settings.s3_secret_access_key or None,
                region=settings.s3_region or "auto",
                public_hostname=settings.s3_public_hostname or None,
            )
        elif backend == "onedrive":
            from .onedrive import OneDriveStorage

            _instance = OneDriveStorage()
        elif backend == "webdav":
            from .webdav import WebDAVStorage

            _instance = WebDAVStorage()
        else:
            raise RuntimeError(f"unknown storage backend: {backend!r}")
        return _instance


def reset_storage_singleton_for_tests() -> None:
    """Drop the cached singleton. Tests only."""
    global _instance
    _instance = None
