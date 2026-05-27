"""Pytest fixtures: SECRETS_KEY default + per-test isolated SQLite app client.

The module-level ``_set_test_env`` call below populates SECRETS_KEY,
JWT_SECRET, ADMIN_TOKEN, and a placeholder DATABASE_URL *before* any ``app.``
module is imported — ``app.main`` validates SECRETS_KEY at import time, and
the db session module reads DATABASE_URL once at module load.

The ``client`` fixture (function-scoped) gives every test a fresh sqlite file
plus an ``httpx.AsyncClient`` wired to the live FastAPI app via
``ASGITransport``. Test isolation is achieved by:

  1. Building a brand-new async engine bound to the per-test sqlite file.
  2. Calling ``Base.metadata.create_all`` on it (alembic-free; the schema is
     in lock-step with the ORM models for this project).
  3. Overriding the ``get_db`` FastAPI dependency to yield sessions from the
     per-test sessionmaker.
  4. Pointing ``app.db.session.SessionLocal`` at the same factory so service
     code that calls ``SessionLocal()`` directly (e.g. the startup
     ``reload_storage`` path) hits the test DB too.

The app singleton itself is shared across tests — re-importing it isn't safe
because of cached module state and middleware registration. The dependency
override is what gives us per-test DB isolation.
"""
from __future__ import annotations

import asyncio
import base64
import os
import secrets
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest


def _set_test_env() -> None:
    """Populate every env var the app reads at import time.

    ``app.main`` checks SECRETS_KEY before any route loads; ``app.core.config``
    reads JWT_SECRET, ADMIN_TOKEN, and DATABASE_URL into the ``settings``
    singleton. All of these must exist before the first ``from app.*`` import.
    """
    if not os.environ.get("SECRETS_KEY"):
        os.environ["SECRETS_KEY"] = base64.urlsafe_b64encode(
            secrets.token_bytes(32)
        ).decode()
    if not os.environ.get("JWT_SECRET"):
        os.environ["JWT_SECRET"] = secrets.token_urlsafe(32)
    # ``ADMIN_TOKEN`` is the plaintext bootstrap password — first successful
    # login auto-migrates it into a hashed ``settings_kv`` row.
    os.environ.setdefault("ADMIN_TOKEN", "test-admin-pw")
    # A reasonable default DB URL so any test that *doesn't* use the per-test
    # ``client`` fixture (e.g. the pure-unit tests) still gets a sensible
    # file path rather than the production ``./data/yui-drop.db``.
    if not os.environ.get("DATABASE_URL"):
        tmp = Path(tempfile.gettempdir()) / "yui-drop-test-default.db"
        os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{tmp}"


_set_test_env()


@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop so async fixtures share one loop."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── Per-test FastAPI client with isolated SQLite DB ────────────────────────


@pytest.fixture
async def client() -> AsyncIterator:
    """Yield an httpx ``AsyncClient`` bound to the FastAPI app with a fresh DB.

    Every test gets its own SQLite file under /tmp so cross-test pollution
    (rows from a previous test bleeding into the next) is impossible.
    """
    # Local imports keep the module-level _set_test_env() call effective —
    # importing httpx/sqlalchemy at the top of conftest would be fine, but
    # importing ``app.*`` at the top would freeze the wrong DATABASE_URL.
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )

    # Unique per-test DB file. token_hex(8) → 16 chars of entropy is plenty
    # for the lifetime of one test session.
    db_path = Path(tempfile.gettempdir()) / f"yui-drop-test-{secrets.token_hex(8)}.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    os.environ["DATABASE_URL"] = url

    # Import AFTER env mutation so ``settings`` picks up the override on its
    # first construction. Subsequent tests reuse the cached singleton, which
    # is fine — we override the DB through a dependency-injection seam rather
    # than mutating settings.
    import app.models  # noqa: F401 — registers every table on Base.metadata
    from app.db import session as session_module
    from app.db.base import Base
    from app.main import app as fastapi_app

    test_engine = create_async_engine(url, future=True)
    test_session_factory = async_sessionmaker(
        bind=test_engine, expire_on_commit=False, autoflush=False,
    )

    # Create schema directly from the ORM metadata. We deliberately bypass
    # alembic here — running ``alembic upgrade head`` in-process is fragile
    # because env.py spawns its own async engine and the test DB url has
    # already been overridden. The migrations and the ORM models are kept in
    # lock-step in this project, so create_all is sufficient for integration
    # tests of the HTTP surface.
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Swap the production sessionmaker for the test one so any service code
    # that imports ``SessionLocal`` (e.g. lifespan storage prime) sees the
    # isolated DB.
    original_session_local = session_module.SessionLocal
    session_module.SessionLocal = test_session_factory

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        async with test_session_factory() as s:
            try:
                yield s
            except Exception:
                await s.rollback()
                raise

    fastapi_app.dependency_overrides[session_module.get_db] = _override_get_db

    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Cleanup: drop the override, restore the original SessionLocal, dispose
    # the engine, and best-effort delete the sqlite file.
    fastapi_app.dependency_overrides.pop(session_module.get_db, None)
    session_module.SessionLocal = original_session_local
    await test_engine.dispose()
    try:
        db_path.unlink()
    except FileNotFoundError:
        pass
