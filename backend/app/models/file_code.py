"""FileCode: one row per pickup-coded share (text or file)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class FileCode(Base):
    """One share = one row.

    ``code`` is unique among active rows. Uniqueness is enforced logically by
    the code generator + the soft-delete filter rather than a DB-level unique
    constraint, so we can keep historical (deleted_at != NULL) rows with the
    same code for audit purposes.
    """

    __tablename__ = "filecodes"

    # Identity
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)

    # Filename presentation (prefix = stem, suffix = extension w/ dot, name = full).
    prefix: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suffix: Mapped[str | None] = mapped_column(String(32), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # File payload (file_path) OR text payload (text). Exactly one is non-null.
    size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)

    # Expiry / usage
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    # -1 = unlimited, >=0 = remaining retrievals before auto-expire.
    expired_count: Mapped[int] = mapped_column(Integer, default=-1, nullable=False)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Upload mechanics
    is_chunked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    upload_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Soft delete
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # Audit (client metadata at create-time)
    created_by_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by_ua: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_filecodes_code_active", "code", "deleted_at"),
    )
