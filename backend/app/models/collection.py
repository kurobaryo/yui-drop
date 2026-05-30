"""Collection: a v0.3.0 shared drop-box room.

One row per room, addressed by a 6-digit ``code``. The creator owns the
bcrypt ``admin_password_hash`` (mandatory) and may set an additional
``entry_password_hash`` (optional) that participants must supply when
joining. Visibility (``public`` / ``creator_only``) is enforced server-side
on every list + SSE event.

The row is hard-deleted by the admin sweeper once a closed room ages past
the retention window; participants and uploads cascade via the FK
``ondelete=CASCADE`` declarations on the child tables.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class Collection(Base):
    """A multi-user shared drop-box room."""

    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # 'public' — every joined member sees everyone's files + messages.
    # 'creator_only' — only the creator (and the uploader themselves) see
    # uploaded files / messages from other members.
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default="public", server_default="public"
    )

    # bcrypt hashes. Entry password is optional (NULL = no entry password);
    # admin password is mandatory and validated per request on admin routes.
    entry_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    admin_password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    upload_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")

    # NULL = permanent. Tested against ``datetime.now(tz=UTC)`` during access.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    max_members: Mapped[int] = mapped_column(Integer, nullable=False, default=200, server_default="200")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
