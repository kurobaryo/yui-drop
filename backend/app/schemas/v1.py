"""Request / response DTOs for the public ``/api/v1`` endpoints.

All schemas use ``extra="forbid"`` so unknown fields produce a 422 instead
of being silently dropped — a habit established by PR #18 (the multi-file
turnstile regression).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ExpireStyle = Literal[
    "minute", "hour", "day", "week", "month", "year", "count", "forever",
]


# ── Simple upload ───────────────────────────────────────────────────────────


class V1UploadResponse(BaseModel):
    """Returned by POST /api/v1/upload and POST /api/v1/upload/{id}/complete."""

    model_config = ConfigDict(extra="forbid")

    code: str
    name: str | None
    size: int
    expired_at: str | None
    expired_count: int = -1
    url: str
    short_url: str


# ── Multipart presigned upload ──────────────────────────────────────────────


class V1MultipartInitRequest(BaseModel):
    """Open a multipart-presigned upload session."""

    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(..., min_length=1, max_length=512)
    file_size: int = Field(..., ge=1)
    content_type: str | None = None
    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"


class V1MultipartInitResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upload_id: str
    key: str
    part_size: int
    parts_total: int
    expires_at: str


class V1SignPartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: int = Field(..., ge=1, le=10000)


class V1SignPartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    headers: dict[str, str] = Field(default_factory=dict)
    expires_at: str
    part_number: int


class V1MultipartPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: int = Field(..., ge=1, le=10000)
    etag: str = Field(..., min_length=1)


class V1MultipartCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parts: list[V1MultipartPart] = Field(..., min_length=1, max_length=10000)


# Complete returns the same shape as simple upload.
V1MultipartCompleteResponse = V1UploadResponse


# ── Text share ──────────────────────────────────────────────────────────────


class V1TextShareRequest(BaseModel):
    """Create a text-only share attributed to the calling API key."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., min_length=1)
    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"


class V1TextShareResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    name: str | None
    size: int
    expired_at: str | None
    expired_count: int = -1
    url: str | None
    short_url: str


# ── Pickup (resolve a code) ─────────────────────────────────────────────────


class V1PickupRequest(BaseModel):
    """Redeem a pickup code.

    NOTE: this is a *consuming* operation upstream — it decrements
    ``expired_count`` and increments ``used_count``, exactly like the public
    SPA pickup. There is no read-only variant.
    """

    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., min_length=1, max_length=16)


class V1PickupFile(BaseModel):
    """One member file of a multi-file share."""

    model_config = ConfigDict(extra="forbid")

    file_id: int
    order: int
    name: str | None
    size: int | None
    url: str | None
    content_type: str | None
    force_download: bool = False


class V1PickupResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    kind: Literal["text", "file", "multi"]
    name: str | None
    size: int | None
    text: str | None
    url: str | None
    content_type: str | None
    force_download: bool = False
    expired_at: str | None
    expired_count: int
    used_count: int
    total_size: int | None = None
    file_count: int | None = None
    files: list[V1PickupFile] | None = None


# ── Share listing / inspection ──────────────────────────────────────────────


class V1ShareListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    name: str | None
    size: int | None
    kind: Literal["text", "file", "multi"]
    # Revoked / swept rows stay listed (metadata only) for SHARE_HISTORY_DAYS.
    status: Literal["active", "expired", "revoked"]
    expired_at: str | None
    expired_count: int
    used_count: int
    created_at: str
    # Live single-file shares: absolute download URL with a fresh signed
    # token. Text, multi and revoked / swept shares: null.
    url: str | None
    short_url: str
    # kind == "multi" only.
    file_count: int | None = None
    total_size: int | None = None
    has_note: bool | None = None


class V1ShareListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int
    items: list[V1ShareListItem]


class V1ShareContentFile(BaseModel):
    """One member file in ``GET /api/v1/shares/{code}?include=content``."""

    model_config = ConfigDict(extra="forbid")

    file_id: str
    order: int
    name: str
    size: int
    content_type: str | None
    force_download: bool = False
    url: str


class V1ShareDetailResponse(V1ShareListItem):
    """A list item; ``?include=content`` adds ``text`` and (multi) ``files``."""

    text: str | None = None
    files: list[V1ShareContentFile] | None = None


# ── Multi-file share ────────────────────────────────────────────────────────
#
# ``share_id`` / ``file_id`` travel as strings matching ``^[A-Za-z0-9_-]+$``.


class V1MultiCreateRequest(BaseModel):
    """Reserve a code for a multi-file share (files follow, then finalize)."""

    model_config = ConfigDict(extra="forbid")

    declared_file_count: int = Field(..., ge=1)
    declared_total_size: int = Field(..., ge=1)
    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"
    # Optional note shown with the files on pickup. At most MAX_TEXT_BYTES of
    # UTF-8 (checked by the service); whitespace-only is stored as no note.
    text: str | None = None


class V1MultiCreateResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    share_id: str
    code: str
    expired_at: str | None
    expired_count: int


class V1MultiFileRequest(BaseModel):
    """Declare one file of a multi-file share."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=512)
    size: int = Field(..., ge=1)
    content_type: str | None = Field(default=None, max_length=255)


class V1MultiFileResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_id: str
    upload_id: str
    part_size: int
    parts_total: int
    expires_at: str


class V1MultiPartResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: int
    etag: str | None


class V1MultiCompletePart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: int = Field(..., ge=1, le=10000)
    # ``null`` when the part upload returned none (non-S3 backends).
    etag: str | None = None


class V1MultiFileCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parts: list[V1MultiCompletePart] = Field(..., min_length=1, max_length=10000)


class V1MultiFileCompleteResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_id: str
    name: str
    size: int


class V1MultiAbortResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    share_id: str
    aborted: bool = True
