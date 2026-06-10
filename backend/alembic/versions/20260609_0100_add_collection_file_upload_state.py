"""add collection file upload state columns

Revision ID: 20260609_0100
Revises: 20260530_0400
Create Date: 2026-06-09 01:00:00.000000

Adds explicit upload-session state for Collection files so pending rows can be
hidden until completion and follow-up part/complete calls can be bound to the
member/file/upload session that created them.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260609_0100"
down_revision: str | None = "20260530_0400"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("collection_files", schema=None) as batch_op:
        batch_op.add_column(sa.Column("upload_id", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("expected_parts_total", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("part_size", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(batch_op.f("ix_collection_files_upload_id"), ["upload_id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_collection_files_completed_at"), ["completed_at"], unique=False
        )

    # Existing rows predate the pending/completed split. Treat them as completed
    # so production upgrades do not hide previously uploaded files.
    op.execute("UPDATE collection_files SET completed_at = created_at WHERE completed_at IS NULL")


def downgrade() -> None:
    with op.batch_alter_table("collection_files", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_collection_files_completed_at"))
        batch_op.drop_index(batch_op.f("ix_collection_files_upload_id"))
        batch_op.drop_column("completed_at")
        batch_op.drop_column("part_size")
        batch_op.drop_column("expected_parts_total")
        batch_op.drop_column("upload_id")
