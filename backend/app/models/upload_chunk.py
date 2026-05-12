"""UploadChunk: one row per server-proxied chunk.

The chunked-upload protocol stores each chunk's metadata here so the orphan
sweeper can reap unfinished sessions. ``upload_id`` groups all chunks for one
in-progress upload; ``MultipartSession`` tracks the session-level row for S3
direct uploads (see ``multipart_session.py``).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class UploadChunk(Base):
    """One row per received chunk."""

    __tablename__ = "upload_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Logical grouping key — all chunks for one upload share this value.
    upload_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # 0-based index of this chunk within the upload.
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # On-disk path to the chunk file (relative to the storage root).
    chunk_path: Mapped[str] = mapped_column(String(1024), nullable=False)

    # Size of this chunk in bytes.
    chunk_size: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Optional per-chunk checksum (sha256 hex by convention).
    hash: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # A given chunk index appears at most once per upload.
        UniqueConstraint("upload_id", "chunk_index", name="uq_upload_chunks_upload_id_chunk_index"),
        Index("ix_upload_chunks_created_at", "created_at"),
    )
