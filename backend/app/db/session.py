"""Async SQLAlchemy engine, session factory, and FastAPI dependency."""
from __future__ import annotations

from collections.abc import AsyncIterator

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
    """
    return create_async_engine(
        settings.database_url,
        echo=False,
        pool_pre_ping=True,
        future=True,
    )


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
