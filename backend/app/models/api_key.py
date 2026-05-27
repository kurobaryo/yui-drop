"""ApiKey: one row per admin-issued API key for /api/v1 access."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class ApiKey(Base):
    """One admin-issued API key = one row.

    Plaintext keys (``yd_<key_id>_<32char_secret>``) are shown exactly once at
    issuance and never persisted; we keep only the bcrypt ``key_hash`` and the
    short public ``key_id`` prefix so admins can identify the key in lists,
    logs, and revocation flows without ever exposing the secret.
    """

    __tablename__ = "api_keys"

    # Identity
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key_id: Mapped[str] = mapped_column(String(16), nullable=False, unique=True, index=True)
    key_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Admin-supplied metadata
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Authorization / scoping. Comma-separated list (e.g. "upload,read").
    scopes: Mapped[str] = mapped_column(
        String(255), nullable=False, default="upload,read", server_default="upload,read",
    )

    # Quotas / limits
    quota_daily_bytes: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=5368709120, server_default="5368709120",
    )
    quota_per_minute: Mapped[int] = mapped_column(
        Integer, nullable=False, default=30, server_default="30",
    )
    max_file_size: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=524288000, server_default="524288000",
    )

    # Lifecycle
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Audit
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    created_by_admin: Mapped[str | None] = mapped_column(String(64), nullable=True)

    def is_active(self, now: datetime) -> bool:
        """True iff this key is not revoked and not past its expiry."""
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None and self.expires_at <= now:
            return False
        return True

    def scopes_list(self) -> list[str]:
        """Parsed ``scopes`` string as a list of trimmed scope tokens."""
        return [s.strip() for s in (self.scopes or "").split(",") if s.strip()]
