"""CollectionFile: a file uploaded into a Collection room.

The storage abstraction handles local-vs-s3 transparently: ``storage_key``
is the object key (R2) or relative path (local FS); ``storage_backend`` is
the literal name of the backend that produced it; ``wrapped_dek`` is
non-NULL only when the local backend's AES-GCM at-rest encryption applied
(S3/R2 relies on bucket-side SSE-S3 instead).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class CollectionFile(Base):
    """One uploaded file inside a Collection room."""

    __tablename__ = "collection_files"

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

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(20), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Only non-NULL on the local backend with at-rest encryption enabled.
    wrapped_dek: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
