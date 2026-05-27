"""add api_keys + api_key_usage tables and created_by_key_id on filecodes

Revision ID: 20260527_0100
Revises: d89c0a886a7e
Create Date: 2026-05-27 01:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '20260527_0100'
down_revision: str | None = 'd89c0a886a7e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'api_keys',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('key_id', sa.String(length=16), nullable=False),
        sa.Column('key_hash', sa.String(length=255), nullable=False),
        sa.Column('note', sa.String(length=255), nullable=True),
        sa.Column('scopes', sa.String(length=255), server_default='upload,read', nullable=False),
        sa.Column('quota_daily_bytes', sa.BigInteger(), server_default='5368709120', nullable=False),
        sa.Column('quota_per_minute', sa.Integer(), server_default='30', nullable=False),
        sa.Column('max_file_size', sa.BigInteger(), server_default='524288000', nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False,
        ),
        sa.Column('created_by_admin', sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_api_keys')),
    )
    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_api_keys_key_id'), ['key_id'], unique=True)
        batch_op.create_index(batch_op.f('ix_api_keys_revoked_at'), ['revoked_at'], unique=False)

    op.create_table(
        'api_key_usage',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('api_key_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('total_bytes', sa.BigInteger(), server_default='0', nullable=False),
        sa.Column('total_calls', sa.Integer(), server_default='0', nullable=False),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['api_key_id'], ['api_keys.id'],
            name=op.f('fk_api_key_usage_api_key_id_api_keys'),
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_api_key_usage')),
        sa.UniqueConstraint('api_key_id', 'date', name='uq_api_key_usage_key_date'),
    )
    with op.batch_alter_table('api_key_usage', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_api_key_usage_api_key_id'), ['api_key_id'], unique=False)
        batch_op.create_index('ix_api_key_usage_key_date', ['api_key_id', 'date'], unique=False)

    with op.batch_alter_table('filecodes', schema=None) as batch_op:
        batch_op.add_column(sa.Column('created_by_key_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            batch_op.f('fk_filecodes_created_by_key_id_api_keys'),
            'api_keys', ['created_by_key_id'], ['id'],
        )
        batch_op.create_index(
            'ix_filecodes_created_by_key_id', ['created_by_key_id'], unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table('filecodes', schema=None) as batch_op:
        batch_op.drop_index('ix_filecodes_created_by_key_id')
        batch_op.drop_constraint(
            batch_op.f('fk_filecodes_created_by_key_id_api_keys'), type_='foreignkey',
        )
        batch_op.drop_column('created_by_key_id')

    with op.batch_alter_table('api_key_usage', schema=None) as batch_op:
        batch_op.drop_index('ix_api_key_usage_key_date')
        batch_op.drop_index(batch_op.f('ix_api_key_usage_api_key_id'))

    op.drop_table('api_key_usage')

    with op.batch_alter_table('api_keys', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_api_keys_revoked_at'))
        batch_op.drop_index(batch_op.f('ix_api_keys_key_id'))

    op.drop_table('api_keys')
