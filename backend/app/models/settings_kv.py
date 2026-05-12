"""SettingsKV: admin-writable runtime configuration overlay."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class SettingsKV(Base):
    """A single key/value row with a JSON value column.

    Used for settings the admin can change at runtime without restart
    (e.g. ``turnstile.enabled``, ``announcement.banner``).
    """

    __tablename__ = "settings_kv"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
