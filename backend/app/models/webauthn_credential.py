"""WebauthnCredential: one row per registered passkey for the admin.

The single-admin model means we don't need a ``user_id`` foreign key — every
row implicitly belongs to the lone admin account. A future multi-admin
migration would add a nullable ``admin_id`` here.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class WebauthnCredential(Base):
    """One registered passkey = one row.

    ``credential_id`` and ``public_key`` are raw bytes as returned by the
    authenticator (and consumed by ``webauthn.verify_authentication_response``);
    we never decode them. ``sign_count`` is bumped on every successful
    authentication and used to detect cloned authenticators (a response with a
    counter ≤ the stored value is rejected, except when the authenticator
    reports the sentinel value 0 every time — common on platform authenticators
    that intentionally do not implement a monotonic counter for privacy).
    """

    __tablename__ = "webauthn_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    credential_id: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
        unique=True,
        index=True,
    )
    public_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sign_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    transports: Mapped[str | None] = mapped_column(String(128), nullable=True)
    aaguid: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
