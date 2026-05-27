"""add created_by_key_id to multipart_sessions

Revision ID: 20260527_0200
Revises: 20260527_0100
Create Date: 2026-05-27 02:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '20260527_0200'
down_revision: str | None = '20260527_0100'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('multipart_sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('created_by_key_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            batch_op.f('fk_multipart_sessions_created_by_key_id_api_keys'),
            'api_keys', ['created_by_key_id'], ['id'],
        )
        batch_op.create_index(
            'ix_multipart_sessions_created_by_key_id',
            ['created_by_key_id'],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table('multipart_sessions', schema=None) as batch_op:
        batch_op.drop_index('ix_multipart_sessions_created_by_key_id')
        batch_op.drop_constraint(
            batch_op.f('fk_multipart_sessions_created_by_key_id_api_keys'),
            type_='foreignkey',
        )
        batch_op.drop_column('created_by_key_id')
