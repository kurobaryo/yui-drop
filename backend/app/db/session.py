"""Async SQLAlchemy engine, session factory, and FastAPI dependency."""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ..core.config import settings


def _make_engine() -> AsyncEngine:
    """Build the global async engine.

    ``pool_pre_ping`` keeps long-idle Postgres connections healthy. SQLite
    on-disk works fine with the default pool; in-memory SQLite is not
    recommended in production for this app.

    SQLite PRAGMAs (applied on every connection):

    - ``journal_mode=WAL`` — Write-Ahead Logging. The DB default (rollback
      journal) serializes all reads against any in-flight write, which
      means a long-polling SSE consumer reading messages would block (and
      eventually trip ``OperationalError: database is locked``) when
      another request issues a write. WAL gives us multi-reader + single-
      writer concurrency: readers don't block writers and vice versa.
      Persistent — one-time per database file.
    - ``synchronous=NORMAL`` — safe with WAL. ``FULL`` is the rollback-
      journal default and adds an extra fsync that we don't need once the
      WAL is in play. Cuts write latency roughly in half.
    - ``busy_timeout=5000`` — when a writer arrives while another writer
      is holding the exclusive lock, wait up to 5 seconds for the lock
      instead of immediately raising ``OperationalError``. Eliminates the
      transient "database is locked" the SSE flood used to trigger when
      lots of clients ticked ``last_seen_at`` in the same heartbeat.
    """
    eng = create_async_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
        future=True,
    )

    # SQLite-only: install per-connection PRAGMAs.
    if settings.database_url.startswith("sqlite"):

        @event.listens_for(eng.sync_engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _connection_record):  # noqa: ANN001
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA journal_mode=WAL;")
                cursor.execute("PRAGMA synchronous=NORMAL;")
                cursor.execute("PRAGMA busy_timeout=5000;")
                cursor.execute("PRAGMA foreign_keys=ON;")
            finally:
                cursor.close()

    return eng


engine: AsyncEngine = _make_engine()

SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yield an AsyncSession; rollback on unhandled error.

    Usage::

        @router.get("/x")
        async def x(db: Annotated[AsyncSession, Depends(get_db)]):
            ...
    """
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
