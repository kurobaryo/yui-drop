"""ApiKeyUsage: daily rollup of bytes and call counts per API key."""
from __future__ import annotations

from datetime import date as date_type
from datetime import datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class ApiKeyUsage(Base):
    """One row per (api_key, UTC date).

    We aggregate bytes and call counts here instead of scanning ``access_logs``
    on every quota check, so /api/v1 request hot-paths can enforce daily
    ceilings with a single indexed row lookup + UPSERT-style increment.
    """

    __tablename__ = "api_key_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_key_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("api_keys.id"), nullable=False, index=True,
    )
    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    total_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0, server_default="0",
    )
    total_calls: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("api_key_id", "date", name="uq_api_key_usage_key_date"),
    )
