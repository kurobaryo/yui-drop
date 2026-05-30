"""OidcBinding: one external OIDC identity bound to the single admin.

Yui-Drop has a single-admin model; OIDC login therefore does not need a
``user_id`` foreign key. Each row binds a ``(provider, subject)`` tuple from
an external IdP to the admin. Multiple rows are allowed so the admin can
register more than one provider (e.g. one Logto, one Google).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class OidcBinding(Base):
    """One external OIDC identity bound to the admin."""

    __tablename__ = "oidc_bindings"
    __table_args__ = (UniqueConstraint("provider", "subject", name="uq_oidc_bindings_provider_subject"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Display label for the provider (e.g. ``"logto"``, ``"google"``). Free-form
    # — set by the admin in OIDC settings (defaults to ``"oidc"``).
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # IdP-issued ``sub`` claim. Globally unique within the provider.
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    # Last-seen email from the ID token, for display only.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Last-seen ``name`` claim from the ID token, for display only.
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
