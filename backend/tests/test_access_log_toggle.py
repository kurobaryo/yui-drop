"""Tests for the audit-toggle-aware AccessLog write path."""
from __future__ import annotations

import base64
import secrets

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import config as config_mod
from app.db.base import Base
from app.models.access_log import AccessLog, AccessLogAction
from app.models.settings_kv import SettingsKV
from app.services.common import record_access


@pytest_asyncio.fixture
async def db_session(monkeypatch):
    monkeypatch.setattr(
        config_mod.settings,
        "secrets_key",
        base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
        raising=True,
    )
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_ip_recorded_when_toggle_absent(db_session):
    """Default behaviour: no settings_kv row ⇒ IP is recorded as-is."""
    await record_access(
        db_session,
        action=AccessLogAction.SHARE_CREATE,
        code="ABC123",
        ip="1.2.3.4",
        ua="UA",
    )
    await db_session.commit()
    row = (await db_session.execute(select(AccessLog))).scalars().first()
    assert row is not None
    assert row.ip == "1.2.3.4"
    assert row.ua == "UA"


@pytest.mark.asyncio
async def test_ip_masked_when_toggle_off(db_session):
    """Toggle off ⇒ IP is forced to None; UA stays."""
    db_session.add(SettingsKV(key="audit.log_access_ip", value=False))
    await db_session.commit()

    await record_access(
        db_session,
        action=AccessLogAction.SHARE_RETRIEVE,
        code="ABC123",
        ip="1.2.3.4",
        ua="UA",
    )
    await db_session.commit()
    row = (await db_session.execute(select(AccessLog))).scalars().first()
    assert row is not None
    assert row.ip is None
    assert row.ua == "UA"


@pytest.mark.asyncio
async def test_ip_recorded_when_toggle_true(db_session):
    db_session.add(SettingsKV(key="audit.log_access_ip", value=True))
    await db_session.commit()

    await record_access(
        db_session,
        action=AccessLogAction.SHARE_CREATE,
        code="ABC123",
        ip="9.9.9.9",
        ua="UA",
    )
    await db_session.commit()
    row = (await db_session.execute(select(AccessLog))).scalars().first()
    assert row is not None
    assert row.ip == "9.9.9.9"
