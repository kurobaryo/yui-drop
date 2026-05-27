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


# ── Share listing / inspection ──────────────────────────────────────────────


class V1ShareListItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    name: str | None
    size: int | None
    kind: Literal["text", "file", "multi"]
    expired_at: str | None
    expired_count: int
    used_count: int
    created_at: str
    url: str | None
    short_url: str


class V1ShareListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total: int
    items: list[V1ShareListItem]


# Single-share detail is the same shape as a list item.
V1ShareDetailResponse = V1ShareListItem
