"""add collections + members + messages + files tables

Revision ID: 20260530_0400
Revises: 20260530_0300
Create Date: 2026-05-30 04:00:00.000000

v0.3.0 Collection feature: a multi-user shared drop-box at /c/{code}.
Four tables, all created in one migration to keep the schema atomic.

* collections          — one room per row, 6-digit code, lifetime, visibility,
                         bcrypt admin + optional entry password hashes.
* collection_members   — opaque session token per joined participant.
* collection_messages  — short text notes (max 2000 chars), soft-deletable.
* collection_files     — file uploads inside a room, wraps the existing
                         storage abstraction (s3 or local + AES-GCM).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260530_0400"
down_revision: str | None = "20260530_0300"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── collections ───────────────────────────────────────────────────────────
    op.create_table(
        "collections",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column(
            "visibility",
            sa.String(length=20),
            nullable=False,
            server_default="public",
        ),
        sa.Column("entry_password_hash", sa.String(length=255), nullable=True),
        sa.Column("admin_password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "upload_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "max_members",
            sa.Integer(),
            nullable=False,
            server_default="200",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("created_by_ip", sa.String(length=64), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collections")),
        sa.UniqueConstraint("code", name=op.f("uq_collections_code")),
    )
    with op.batch_alter_table("collections", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_collections_code"), ["code"], unique=False
        )

    # ── collection_members ────────────────────────────────────────────────────
    op.create_table(
        "collection_members",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("member_token", sa.String(length=64), nullable=False),
        sa.Column("nickname", sa.String(length=40), nullable=False),
        sa.Column("ip_masked", sa.String(length=64), nullable=True),
        sa.Column(
            "is_creator",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["collection_id"],
            ["collections.id"],
            name=op.f("fk_collection_members_collection_id_collections"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collection_members")),
        sa.UniqueConstraint(
            "member_token", name=op.f("uq_collection_members_member_token")
        ),
        sa.UniqueConstraint(
            "collection_id",
            "member_token",
            name="uq_collection_members_room_token",
        ),
    )
    with op.batch_alter_table("collection_members", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_collection_members_collection_id"),
            ["collection_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_collection_members_member_token"),
            ["member_token"],
            unique=False,
        )

    # ── collection_messages ───────────────────────────────────────────────────
    op.create_table(
        "collection_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.String(length=2000), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["collection_id"],
            ["collections.id"],
            name=op.f("fk_collection_messages_collection_id_collections"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["collection_members.id"],
            name=op.f("fk_collection_messages_member_id_collection_members"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collection_messages")),
    )
    with op.batch_alter_table("collection_messages", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_collection_messages_collection_id"),
            ["collection_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_collection_messages_member_id"),
            ["member_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_collection_messages_created_at"),
            ["created_at"],
            unique=False,
        )

    # ── collection_files ──────────────────────────────────────────────────────
    op.create_table(
        "collection_files",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("storage_backend", sa.String(length=20), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("wrapped_dek", sa.LargeBinary(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["collection_id"],
            ["collections.id"],
            name=op.f("fk_collection_files_collection_id_collections"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["collection_members.id"],
            name=op.f("fk_collection_files_member_id_collection_members"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collection_files")),
    )
    with op.batch_alter_table("collection_files", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_collection_files_collection_id"),
            ["collection_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_collection_files_member_id"),
            ["member_id"],
            unique=False,
        )
        batch_op.create_index(
            batch_op.f("ix_collection_files_created_at"),
            ["created_at"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("collection_files", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_collection_files_created_at"))
        batch_op.drop_index(batch_op.f("ix_collection_files_member_id"))
        batch_op.drop_index(batch_op.f("ix_collection_files_collection_id"))
    op.drop_table("collection_files")

    with op.batch_alter_table("collection_messages", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_collection_messages_created_at"))
        batch_op.drop_index(batch_op.f("ix_collection_messages_member_id"))
        batch_op.drop_index(batch_op.f("ix_collection_messages_collection_id"))
    op.drop_table("collection_messages")

    with op.batch_alter_table("collection_members", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_collection_members_member_token"))
        batch_op.drop_index(batch_op.f("ix_collection_members_collection_id"))
    op.drop_table("collection_members")

    with op.batch_alter_table("collections", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_collections_code"))
    op.drop_table("collections")
