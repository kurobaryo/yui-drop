"""ShareFile: one file inside a multi-file share.

A ``kind='multi'`` row in ``filecodes`` is the parent; this table holds one
row per declared file. ``state`` walks ``pending → uploading → complete``
(``failed`` on bucket-side mismatch). ``order`` is a stable 1-based display
index. ``file_path`` is the storage key (per-share prefix +
per-file uuid + sanitized suffix on the local backend; same key shape on S3).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class ShareFile(Base):
    """One file inside a multi-file share. Multiple per ``filecodes`` row."""

    __tablename__ = "share_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    share_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("filecodes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    order: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    prefix: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suffix: Mapped[str | None] = mapped_column(String(32), nullable=True)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Local-backend chunk session id when the file was uploaded via /api/chunk;
    # S3 UploadId when via /api/presign. NULL if not applicable.
    upload_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_chunked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # State machine:
    #   pending   — row created, no bytes received yet
    #   uploading — upload in progress (chunk session open)
    #   complete  — bytes finalized in storage
    #   failed    — completion attempted but bucket-side size mismatch
    state: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("ix_share_files_share_order", "share_id", "order"),
    )
