"""CollectionMember: one joined participant per row.

``member_token`` is a 32-byte ``secrets.token_urlsafe`` value stored on the
client in ``localStorage`` (key: ``yui-collection:member:{code}``). It is
used to authenticate every member-level POST/GET against the room and is
passed via the ``X-Member-Token`` header (or ``?token=`` query for SSE,
because EventSource cannot set custom headers).

The token is opaque to the client: regenerating it requires re-joining the
room.

``is_creator`` is flipped to True whenever the member successfully verifies
the admin password (``POST /{code}/admin/verify``). Multiple members can be
creators simultaneously — anyone with the admin password counts.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class CollectionMember(Base):
    """A joined participant in a Collection room."""

    __tablename__ = "collection_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("collections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Opaque session token. Unique globally so a lookup never needs both
    # (collection_id, token); a unique composite is also declared below to
    # match the brief's column spec.
    member_token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    nickname: Mapped[str] = mapped_column(String(40), nullable=False)
    ip_masked: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_creator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("collection_id", "member_token", name="uq_collection_members_room_token"),
    )
