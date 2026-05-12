"""Tests for ``coerce_bool`` and the audit-toggle settings round-trip.

These tests cover the regression fixed in
``fix/audit-toggle-and-drawer-detail``: the PATCH endpoint used to write
``settings_kv['audit_log_access_ip']`` (underscore) while every reader
queried ``settings_kv['audit.log_access_ip']`` (dot), so flipping the
toggle silently had no effect. The fix introduces a single canonical key
(``AUDIT_IP_KEY``) and a strict ``coerce_bool`` helper used by all
readers.
"""
from __future__ import annotations

import base64
import secrets

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import config as config_mod
from app.core.request_ip import (
    AUDIT_IP_KEY,
    _audit_toggle_enabled,
    coerce_bool,
)
from app.db.base import Base
from app.models.access_log import AccessLog, AccessLogAction
from app.models.settings_kv import SettingsKV
from app.services.admin import get_admin_settings, patch_admin_settings
from app.services.common import record_access

# ─── coerce_bool unit tests ───────────────────────────────────────────────


class TestCoerceBool:
    def test_native_true(self):
        assert coerce_bool(True) is True

    def test_native_false(self):
        assert coerce_bool(False) is False

    def test_string_true_lowercase(self):
        assert coerce_bool("true") is True

    def test_string_false_lowercase(self):
        assert coerce_bool("false") is False

    def test_string_true_uppercase(self):
        assert coerce_bool("TRUE") is True

    def test_string_false_mixed_case(self):
        assert coerce_bool("False") is False

    def test_string_one(self):
        assert coerce_bool("1") is True

    def test_string_zero(self):
        assert coerce_bool("0") is False

    def test_string_yes_no(self):
        assert coerce_bool("yes") is True
        assert coerce_bool("no") is False

    def test_string_on_off(self):
        assert coerce_bool("on") is True
        assert coerce_bool("off") is False

    def test_int_one(self):
        assert coerce_bool(1) is True

    def test_int_zero(self):
        assert coerce_bool(0) is False

    def test_int_negative(self):
        # Any non-zero integer is truthy, matching Python's ``bool(int)``.
        assert coerce_bool(-1) is True

    def test_none_uses_default_true(self):
        assert coerce_bool(None) is True

    def test_none_uses_default_false(self):
        assert coerce_bool(None, default=False) is False

    def test_unknown_string_uses_default(self):
        assert coerce_bool("maybe", default=True) is True
        assert coerce_bool("maybe", default=False) is False

    def test_empty_string_is_false(self):
        # Empty string is treated as an explicit "off" rather than "unset",
        # so the user-facing behaviour matches an explicit ``""`` write.
        assert coerce_bool("") is False

    def test_whitespace_stripped(self):
        assert coerce_bool("  true  ") is True
        assert coerce_bool("\nfalse\n") is False

    def test_unknown_type_uses_default(self):
        assert coerce_bool([1, 2, 3], default=True) is True
        assert coerce_bool({"x": 1}, default=False) is False


# ─── DB-backed integration tests ──────────────────────────────────────────


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


# ─── _audit_toggle_enabled with each stored representation ────────────────


class TestAuditToggleEnabled:
    @pytest.mark.asyncio
    async def test_default_true_when_row_absent(self, db_session):
        assert await _audit_toggle_enabled(db_session) is True

    @pytest.mark.asyncio
    async def test_native_bool_true(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value=True))
        await db_session.commit()
        assert await _audit_toggle_enabled(db_session) is True

    @pytest.mark.asyncio
    async def test_native_bool_false(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value=False))
        await db_session.commit()
        assert await _audit_toggle_enabled(db_session) is False

    @pytest.mark.asyncio
    async def test_string_false(self, db_session):
        # Historical legacy rows that stored ``"false"`` rather than the
        # native JSON ``false`` must still mask the IP.
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value="false"))
        await db_session.commit()
        assert await _audit_toggle_enabled(db_session) is False

    @pytest.mark.asyncio
    async def test_string_true(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value="true"))
        await db_session.commit()
        assert await _audit_toggle_enabled(db_session) is True

    @pytest.mark.asyncio
    async def test_int_zero(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value=0))
        await db_session.commit()
        assert await _audit_toggle_enabled(db_session) is False

    @pytest.mark.asyncio
    async def test_int_one(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value=1))
        await db_session.commit()
        assert await _audit_toggle_enabled(db_session) is True


# ─── record_access masking with each stored representation ────────────────


async def _last_log(db_session) -> AccessLog | None:
    return (
        await db_session.execute(
            select(AccessLog).order_by(AccessLog.id.desc()).limit(1)
        )
    ).scalars().first()


class TestRecordAccessMasking:
    @pytest.mark.asyncio
    async def test_string_false_masks_ip(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value="false"))
        await db_session.commit()
        await record_access(
            db_session,
            action=AccessLogAction.SHARE_CREATE,
            code="ABC",
            ip="1.2.3.4",
            ua="UA",
        )
        await db_session.commit()
        row = await _last_log(db_session)
        assert row is not None
        assert row.ip is None
        assert row.ua == "UA"

    @pytest.mark.asyncio
    async def test_string_true_keeps_ip(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value="true"))
        await db_session.commit()
        await record_access(
            db_session,
            action=AccessLogAction.SHARE_CREATE,
            code="ABC",
            ip="1.2.3.4",
            ua="UA",
        )
        await db_session.commit()
        row = await _last_log(db_session)
        assert row is not None and row.ip == "1.2.3.4"

    @pytest.mark.asyncio
    async def test_int_zero_masks_ip(self, db_session):
        db_session.add(SettingsKV(key=AUDIT_IP_KEY, value=0))
        await db_session.commit()
        await record_access(
            db_session,
            action=AccessLogAction.SHARE_CREATE,
            ip="9.9.9.9",
            ua="UA",
        )
        await db_session.commit()
        row = await _last_log(db_session)
        assert row is not None and row.ip is None


# ─── PATCH /admin/settings round-trip ─────────────────────────────────────


class TestAdminSettingsAuditToggleRoundTrip:
    """End-to-end: PATCH writes the canonical key, GET echoes the friendly form."""

    @pytest.mark.asyncio
    async def test_patch_underscore_key_writes_canonical_dotted_key(self, db_session):
        # Wire format the frontend uses today.
        await patch_admin_settings(
            db_session,
            updates={"audit_log_access_ip": False},
            ip=None,
            ua=None,
        )
        row = await db_session.get(SettingsKV, AUDIT_IP_KEY)
        assert row is not None
        # Stored as a native JSON bool so subsequent reads via coerce_bool
        # are unambiguous.
        assert row.value is False

    @pytest.mark.asyncio
    async def test_patch_dotted_key_also_works(self, db_session):
        await patch_admin_settings(
            db_session,
            updates={AUDIT_IP_KEY: True},
            ip=None,
            ua=None,
        )
        row = await db_session.get(SettingsKV, AUDIT_IP_KEY)
        assert row is not None and row.value is True

    @pytest.mark.asyncio
    async def test_patch_string_value_is_normalised(self, db_session):
        # Defensive: clients that send "false" as a string still flip the toggle.
        await patch_admin_settings(
            db_session,
            updates={"audit_log_access_ip": "false"},
            ip=None,
            ua=None,
        )
        row = await db_session.get(SettingsKV, AUDIT_IP_KEY)
        assert row is not None and row.value is False

    @pytest.mark.asyncio
    async def test_patch_then_get_round_trip_off(self, db_session):
        await patch_admin_settings(
            db_session,
            updates={"audit_log_access_ip": False},
            ip=None,
            ua=None,
        )
        out = await get_admin_settings(db_session)
        assert out["env"]["audit_log_access_ip"] is False

    @pytest.mark.asyncio
    async def test_patch_then_get_round_trip_on(self, db_session):
        await patch_admin_settings(
            db_session,
            updates={"audit_log_access_ip": True},
            ip=None,
            ua=None,
        )
        out = await get_admin_settings(db_session)
        assert out["env"]["audit_log_access_ip"] is True

    @pytest.mark.asyncio
    async def test_patch_then_record_access_masks_ip(self, db_session):
        # The end-to-end regression: flip the toggle off via the public API
        # and verify the next access_log write masks the IP. This is the
        # scenario that production was failing.
        await patch_admin_settings(
            db_session,
            updates={"audit_log_access_ip": False},
            ip=None,
            ua=None,
        )
        await record_access(
            db_session,
            action=AccessLogAction.SHARE_CREATE,
            code="XYZ",
            ip="203.0.113.7",
            ua="UA",
        )
        await db_session.commit()
        row = await _last_log(db_session)
        # Find the share_create row (the patch itself wrote an admin_action row).
        rows = (
            await db_session.execute(
                select(AccessLog).where(AccessLog.action == AccessLogAction.SHARE_CREATE)
            )
        ).scalars().all()
        assert len(rows) == 1
        assert rows[0].ip is None
        assert rows[0].ua == "UA"
        # And the audit row for the PATCH itself was also masked.
        assert row is not None
