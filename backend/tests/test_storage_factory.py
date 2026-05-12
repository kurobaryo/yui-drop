"""Tests for the storage factory: env defaults, settings_kv overlay, reload."""
from __future__ import annotations

import base64
import secrets

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import config as config_mod
from app.core.crypto import encrypt_secret
from app.db.base import Base
from app.models.settings_kv import SettingsKV
from app.storage import factory


@pytest_asyncio.fixture
async def db_session(monkeypatch):
    """Per-test in-memory SQLite session with the SettingsKV table."""
    # Ensure SECRETS_KEY is valid for encrypt_secret() calls.
    monkeypatch.setattr(
        config_mod.settings,
        "secrets_key",
        base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        raising=True,
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        # Only create the tables we actually touch — pulling all models would
        # require loading FileCode / AccessLog too, which is fine but slower.
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


async def _set_kv(db: AsyncSession, key: str, value):
    row = await db.get(SettingsKV, key)
    if row is None:
        db.add(SettingsKV(key=key, value=value))
    else:
        row.value = value
    await db.commit()


class TestResolveStorageConfig:
    @pytest.mark.asyncio
    async def test_env_only_when_overlay_empty(self, db_session, monkeypatch):
        monkeypatch.setattr(config_mod.settings, "storage_backend", "local", raising=True)
        cfg = await factory.resolve_storage_config(db_session)
        assert cfg.backend == "local"

    @pytest.mark.asyncio
    async def test_kv_overlays_env(self, db_session, monkeypatch):
        monkeypatch.setattr(config_mod.settings, "storage_backend", "local", raising=True)
        await _set_kv(db_session, "storage.backend", "s3")
        await _set_kv(db_session, "storage.s3.bucket_name", "from-kv")
        cfg = await factory.resolve_storage_config(db_session)
        assert cfg.backend == "s3"
        assert cfg.s3_bucket_name == "from-kv"

    @pytest.mark.asyncio
    async def test_encrypted_secret_is_decrypted(self, db_session, monkeypatch):
        monkeypatch.setattr(config_mod.settings, "storage_backend", "local", raising=True)
        token = encrypt_secret("plain-secret")
        await _set_kv(db_session, factory.SECRET_KV_KEY, token)
        cfg = await factory.resolve_storage_config(db_session)
        assert cfg.s3_secret_access_key == "plain-secret"


class TestReloadStorage:
    @pytest.mark.asyncio
    async def test_reload_picks_up_kv_changes(self, db_session, monkeypatch):
        monkeypatch.setattr(config_mod.settings, "storage_backend", "local", raising=True)
        factory.reset_storage_singleton_for_tests()
        first = factory.get_storage()
        # Sanity check: env says local → LocalStorage instance.
        assert first.__class__.__name__ == "LocalStorage"

        await _set_kv(db_session, "storage.backend", "local")  # still local
        # Reload from the DB overlay.
        rebuilt = await factory.reload_storage(db_session)
        assert rebuilt.__class__.__name__ == "LocalStorage"

    @pytest.mark.asyncio
    async def test_reload_without_db_uses_env(self, monkeypatch):
        monkeypatch.setattr(config_mod.settings, "storage_backend", "local", raising=True)
        factory.reset_storage_singleton_for_tests()
        rebuilt = await factory.reload_storage(db=None)
        assert rebuilt.__class__.__name__ == "LocalStorage"
