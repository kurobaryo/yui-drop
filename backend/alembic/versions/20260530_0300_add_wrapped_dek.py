"""add wrapped_dek column to filecodes

Revision ID: 20260530_0300
Revises: 20260530_0200
Create Date: 2026-05-30 03:00:00.000000

NULL means the file is not at-rest encrypted (legacy rows or S3 path where
bucket-side SSE-S3 handles encryption). Non-NULL holds the AES-GCM-wrapped
per-file DEK; see ``app.core.crypto.wrap_dek``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260530_0300"
down_revision: str | None = "20260530_0200"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("filecodes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("wrapped_dek", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("filecodes", schema=None) as batch_op:
        batch_op.drop_column("wrapped_dek")
