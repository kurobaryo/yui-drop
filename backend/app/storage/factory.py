"""Storage backend factory with a settings_kv overlay.

Resolution order, per key:
    1. ``settings_kv['storage.backend']`` / ``settings_kv['storage.s3.*']``
    2. ``.env`` / process environment (``settings.storage_backend``, ``settings.s3_*``)

The merged config is computed by :func:`resolve_storage_config`. The cached
singleton lives in ``_instance``; call :func:`reload_storage` after the admin
saves new storage settings to drop the cache so the next request rebuilds it.

The DB overlay read is async (sqlalchemy AsyncSession). The factory itself
keeps a synchronous front-door (`get_storage()`) so callers don't change.
On startup we don't have an AsyncSession yet, so the first build uses
env-only; once the admin endpoint touches `reload_storage(db=...)` we read
the overlay.
"""
from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.crypto import decrypt_secret
from ..models.settings_kv import SettingsKV
from .base import StorageBackend

_instance: StorageBackend | None = None
_lock = threading.Lock()
_async_lock = asyncio.Lock()


@dataclass
class ResolvedStorageConfig:
    """The merged env + settings_kv config used to build a backend."""

    backend: str
    s3_endpoint_url: str
    s3_bucket_name: str
    s3_access_key_id: str
    s3_secret_access_key: str
    s3_region: str
    s3_public_hostname: str

    @classmethod
    def from_env(cls) -> ResolvedStorageConfig:
        return cls(
            backend=settings.storage_backend,
            s3_endpoint_url=settings.s3_endpoint_url,
            s3_bucket_name=settings.s3_bucket_name,
            s3_access_key_id=settings.s3_access_key_id,
            s3_secret_access_key=settings.s3_secret_access_key,
            s3_region=settings.s3_region or "auto",
            s3_public_hostname=settings.s3_public_hostname,
        )


# settings_kv keys we care about, mapped to the field on ResolvedStorageConfig.
_KV_TO_FIELD: dict[str, str] = {
    "storage.backend": "backend",
    "storage.s3.endpoint_url": "s3_endpoint_url",
    "storage.s3.bucket_name": "s3_bucket_name",
    "storage.s3.access_key_id": "s3_access_key_id",
    "storage.s3.region": "s3_region",
    "storage.s3.public_hostname": "s3_public_hostname",
}
SECRET_KV_KEY = "storage.s3.secret_access_key"  # AES-GCM encrypted


async def _kv_overlay(db: AsyncSession) -> dict[str, Any]:
    """Return all storage.* rows as a dict ``{key: value}``."""
    res = await db.execute(
        select(SettingsKV).where(SettingsKV.key.like("storage.%"))
    )
    return {row.key: row.value for row in res.scalars()}


async def resolve_storage_config(db: AsyncSession) -> ResolvedStorageConfig:
    """Compute the merged config: env defaults with settings_kv overrides on top."""
    cfg = ResolvedStorageConfig.from_env()
    overlay = await _kv_overlay(db)
    for key, field in _KV_TO_FIELD.items():
        if key in overlay and overlay[key] is not None:
            value = overlay[key]
            if isinstance(value, str):
                setattr(cfg, field, value)
    # Decrypt the secret access key if the overlay holds one.
    enc = overlay.get(SECRET_KV_KEY)
    if isinstance(enc, str) and enc:
        try:
            cfg.s3_secret_access_key = decrypt_secret(enc)
        except Exception:
            # Leave the env value in place if decryption fails; do not crash
            # the factory — the admin endpoint surfaces the error separately.
            pass
    return cfg


def _build_from_config(cfg: ResolvedStorageConfig) -> StorageBackend:
    backend = cfg.backend
    if backend == "local":
        from .local import LocalStorage

        return LocalStorage(settings.local_storage_dir)
    if backend == "s3":
        from .s3 import S3Storage

        return S3Storage(
            bucket=cfg.s3_bucket_name,
            endpoint_url=cfg.s3_endpoint_url or None,
            access_key=cfg.s3_access_key_id or None,
            secret_key=cfg.s3_secret_access_key or None,
            region=cfg.s3_region or "auto",
            public_hostname=cfg.s3_public_hostname or None,
        )
    if backend == "onedrive":
        from .onedrive import OneDriveStorage

        return OneDriveStorage()
    if backend == "webdav":
        from .webdav import WebDAVStorage

        return WebDAVStorage()
    raise RuntimeError(f"unknown storage backend: {backend!r}")


def get_storage() -> StorageBackend:
    """Return the configured storage backend (singleton).

    On first call this uses env-only config. Call :func:`reload_storage`
    after the admin updates ``settings_kv`` to switch the active backend.
    """
    global _instance
    if _instance is not None:
        return _instance
    with _lock:
        if _instance is not None:
            return _instance
        _instance = _build_from_config(ResolvedStorageConfig.from_env())
        return _instance


async def reload_storage(db: AsyncSession | None = None) -> StorageBackend:
    """Rebuild the storage backend, reading the latest settings_kv overlay.

    Pass an ``AsyncSession`` to honour the DB overlay; without one we fall
    back to env-only (useful in tests).
    """
    global _instance
    async with _async_lock:
        if db is None:
            cfg = ResolvedStorageConfig.from_env()
        else:
            cfg = await resolve_storage_config(db)
        _instance = _build_from_config(cfg)
        return _instance


def reset_storage_singleton_for_tests() -> None:
    """Drop the cached singleton. Tests only."""
    global _instance
    _instance = None


__all__ = [
    "get_storage",
    "reload_storage",
    "reset_storage_singleton_for_tests",
    "resolve_storage_config",
    "ResolvedStorageConfig",
    "SECRET_KV_KEY",
]
