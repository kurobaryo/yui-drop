"""add oidc_bindings table

Revision ID: 20260530_0100
Revises: 20260527_0200
Create Date: 2026-05-30 01:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260530_0100"
down_revision: str | None = "20260527_0200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "oidc_bindings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_oidc_bindings")),
        sa.UniqueConstraint(
            "provider",
            "subject",
            name="uq_oidc_bindings_provider_subject",
        ),
    )
    with op.batch_alter_table("oidc_bindings", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_oidc_bindings_provider"),
            ["provider"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("oidc_bindings", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_oidc_bindings_provider"))
    op.drop_table("oidc_bindings")
