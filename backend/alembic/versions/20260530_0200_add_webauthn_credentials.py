"""add webauthn_credentials table

Revision ID: 20260530_0200
Revises: 20260527_0200
Create Date: 2026-05-30 02:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260530_0200"
down_revision: str | None = "20260530_0100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("transports", sa.String(length=128), nullable=True),
        sa.Column("aaguid", sa.LargeBinary(), nullable=True),
        sa.Column("label", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webauthn_credentials")),
    )
    with op.batch_alter_table("webauthn_credentials", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_webauthn_credentials_credential_id"),
            ["credential_id"],
            unique=True,
        )


def downgrade() -> None:
    with op.batch_alter_table("webauthn_credentials", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_webauthn_credentials_credential_id"))
    op.drop_table("webauthn_credentials")
