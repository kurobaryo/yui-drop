"""AccessLog: append-only audit row for share + admin operations."""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class AccessLogAction(enum.StrEnum):
    """Coarse audit action taxonomy.

    The fine-grained event lives inside ``extra`` as a JSON ``event`` key
    (e.g. ``{"event": "share.create.text"}``). Routing & dashboards filter on
    this top-level enum first, then drill down.
    """

    SHARE_CREATE = "share_create"
    SHARE_RETRIEVE = "share_retrieve"
    ADMIN_ACTION = "admin_action"


class AccessLog(Base):
    __tablename__ = "access_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    action: Mapped[AccessLogAction] = mapped_column(
        Enum(AccessLogAction, native_enum=False, length=32), nullable=False, index=True
    )
    code: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ua: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_access_logs_action_ts", "action", "ts"),
    )
