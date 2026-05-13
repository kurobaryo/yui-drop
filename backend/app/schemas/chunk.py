"""Chunked-upload endpoint DTOs."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ExpireStyle = Literal["minute", "hour", "day", "week", "month", "year", "count", "forever"]


class ChunkInitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_name: str = Field(..., min_length=1, max_length=512)
    file_size: int = Field(..., ge=0)
    chunk_size: int = Field(..., ge=1)
    file_hash: str | None = None
    content_type: str | None = None
    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"
    # Cloudflare Turnstile token for the upload gate. Optional on the wire;
    # the route enforces only when turnstile is enabled + protect_upload is on.
    turnstile_token: str | None = None


class ChunkInitResponse(BaseModel):
    upload_id: str
    total_chunks: int
    uploaded_chunks: list[int] = []
    resumed: bool = False


class ChunkStatusResponse(BaseModel):
    upload_id: str
    file_name: str
    file_size: int
    chunk_size: int | None = None
    total_chunks: int
    uploaded_chunks: list[int] = []
    expires_at: str


class ChunkCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"


class ChunkCompleteResponse(BaseModel):
    code: str
    name: str
    size: int
