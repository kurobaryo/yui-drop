"""CollectionMessage: a short text note posted into a room.

Hard size cap is 2000 characters (enforced by the schema layer). Soft delete
via ``deleted_at`` so the admin / author can remove a note without losing
audit data — the listing endpoints and SSE broadcaster both exclude rows
with a non-NULL ``deleted_at``.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class CollectionMessage(Base):
    """A short text note ('leave-a-note' style) inside a Collection."""

    __tablename__ = "collection_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    collection_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("collections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    member_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("collection_members.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    body: Mapped[str] = mapped_column(String(2000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
