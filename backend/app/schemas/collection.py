"""Pydantic DTOs for the v0.3.0 Collection (shared-room) API.

Every endpoint exchanges these typed bodies. Field validators enforce the
brief's hard caps (room name ≤ 120 chars, message body ≤ 2000 chars,
nickname ≤ 40 chars, admin password ≥ 4 chars).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ── Create ─────────────────────────────────────────────────────────────────


class CreateCollectionRequest(BaseModel):
    """POST /api/collections — request body."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=120)
    visibility: Literal["public", "creator_only"] = "public"
    entry_password: str | None = Field(default=None, min_length=1, max_length=128)
    admin_password: str = Field(..., min_length=4, max_length=128)
    # Lifetime: ``forever`` = permanent, or 1..365 days. Frontend renders
    # presets (1d / 7d / 30d / 365d / custom / permanent); server treats
    # them uniformly.
    lifetime_days: int | None = Field(default=None, ge=1, le=365)
    # When True, ``lifetime_days`` is ignored — room never expires.
    permanent: bool = False
    # Initial nickname for the creator's auto-join. Optional; the frontend
    # may also call ``/join`` separately, but the typical flow is one round
    # trip on create.
    creator_nickname: str | None = Field(default=None, min_length=1, max_length=40)
    # v2 per-room policy. Stored in settings_kv (no schema migration) and
    # enforced server-side during upload/message creation.
    max_file_bytes: int | None = Field(default=2 * 1024**3, ge=1)
    capacity_bytes: int | None = Field(default=10 * 1024**3, ge=1)
    allow_messages: bool = True
    notify_on_activity: bool = False


class CreateCollectionResponse(BaseModel):
    code: str
    name: str | None
    visibility: str
    upload_enabled: bool
    expires_at: str | None
    has_entry_password: bool
    # Only present when ``creator_nickname`` was supplied — the creator's
    # auto-issued member token (and is_creator=True flag).
    member_token: str | None = None
    member_id: int | None = None


# ── Preview (public, no auth) ──────────────────────────────────────────────


class PreviewResponse(BaseModel):
    """GET /api/collections/{code}/preview — public-safe metadata."""

    visible: bool
    closed: bool
    has_entry_password: bool
    name: str | None
    member_count: int
    file_count: int
    message_count: int
    visibility: str
    max_file_bytes: int | None = None
    capacity_bytes: int | None = None
    allow_messages: bool = True
    notify_on_activity: bool = False


# ── Join ───────────────────────────────────────────────────────────────────


class JoinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nickname: str = Field(..., min_length=1, max_length=40)
    entry_password: str | None = Field(default=None, max_length=128)


class JoinResponse(BaseModel):
    member_token: str
    member_id: int
    visibility: str
    upload_enabled: bool
    nickname: str
    is_creator: bool


# ── Messages ───────────────────────────────────────────────────────────────


class SendMessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., min_length=1, max_length=2000)


class MessageDTO(BaseModel):
    id: int
    member_id: int
    nickname: str
    body: str
    created_at: str


class SendMessageResponse(BaseModel):
    message: MessageDTO


class ListMessagesResponse(BaseModel):
    messages: list[MessageDTO]


# ── Files ──────────────────────────────────────────────────────────────────


class FileInitRequest(BaseModel):
    """POST /api/collections/{code}/files/init — declare an upload."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=255)
    size: int = Field(..., ge=0)
    content_type: str | None = Field(default=None, max_length=255)
    # Optional hint from the client; ignored when the chunk service computes
    # its own part size.
    chunk_size: int | None = Field(default=None, ge=1)


class FileInitResponse(BaseModel):
    upload_id: str
    backend: str
    total_chunks: int
    # Optional per-part size advertised back to the client when the s3
    # backend computed one. NULL on the local backend.
    presigned_part_size: int | None = None


class FileDTO(BaseModel):
    id: int
    member_id: int
    nickname: str
    name: str
    size: int
    content_type: str | None
    created_at: str


class FileCompleteResponse(BaseModel):
    file: FileDTO


class ListFilesResponse(BaseModel):
    files: list[FileDTO]


class FileDownloadResponse(BaseModel):
    """Returned by the download endpoint when no presigned URL is needed.

    For S3 backends the field is populated with a short-lived presigned
    GET; for local backends the frontend should follow ``download_url``
    too — it points at a same-origin token-protected proxy that streams
    the decrypted bytes.
    """

    download_url: str
    expires_in: int


# ── Admin ──────────────────────────────────────────────────────────────────


class AdminToggleUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class AdminVerifyResponse(BaseModel):
    is_creator: bool
    visibility: str
    upload_enabled: bool
    closed: bool
