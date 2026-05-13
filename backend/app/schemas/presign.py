"""S3-multipart presign endpoint DTOs."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ExpireStyle = Literal["minute", "hour", "day", "week", "month", "year", "count", "forever"]


class PresignInitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(..., min_length=1, max_length=512)
    file_size: int = Field(..., ge=1)
    content_type: str | None = None
    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"
    # Cloudflare Turnstile token. Optional on the wire; the route enforces
    # presence/validity only when turnstile is enabled and the
    # ``protect_upload`` flag is on. Skipping it elsewhere keeps legacy
    # clients working when the gate is off.
    turnstile_token: str | None = None


class PresignInitResponse(BaseModel):
    upload_id: str
    key: str
    part_size: int
    parts_total: int
    s3_upload_id: str
    expires_at: str


class PresignSignPartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: int = Field(..., ge=1, le=10000)


class PresignSignPartResponse(BaseModel):
    url: str
    headers: dict[str, str] = {}
    expires_at: str
    part_number: int


class PresignPart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    part_number: int = Field(..., ge=1, le=10000)
    etag: str = Field(..., min_length=1)


class PresignCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parts: list[PresignPart]


class PresignCompleteResponse(BaseModel):
    code: str
    name: str
    size: int


class PresignStatusResponse(BaseModel):
    upload_id: str
    key: str
    file_name: str
    file_size: int
    parts_total: int
    parts_uploaded: list[int]
    expires_at: str
