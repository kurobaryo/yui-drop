"""add last_pickup_at and deleted_reason to filecodes

Revision ID: 20261006_0100
Revises: 20260530_0400
Create Date: 2026-10-06 01:00:00.000000

* ``last_pickup_at`` — timestamp of the most recent successful pickup. Signed
  download links stay valid for a short window after a pickup, so the
  retention sweeper keeps a count-exhausted share around until that window
  has passed.
* ``deleted_reason`` — why a row was soft-deleted: ``expired`` (sweeper) or
  ``revoked`` (owner). NULL for live rows and for rows deleted before this
  column existed.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20261006_0100"
down_revision: str | None = "20260530_0400"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("filecodes", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("last_pickup_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("deleted_reason", sa.String(length=16), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("filecodes", schema=None) as batch_op:
        batch_op.drop_column("deleted_reason")
        batch_op.drop_column("last_pickup_at")
