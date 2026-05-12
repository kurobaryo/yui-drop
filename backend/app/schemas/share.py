"""Share endpoint DTOs."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ExpireStyle = Literal["minute", "hour", "day", "week", "month", "year", "count", "forever"]


class ShareTextRequest(BaseModel):
    """POST /api/share/text — body."""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., min_length=1)
    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"


class ShareTextResponse(BaseModel):
    code: str
    name: str | None = None
    expired_at: str | None = None
    expired_count: int = -1


class ShareFileResponse(BaseModel):
    code: str
    name: str
    size: int
    expired_at: str | None = None
    expired_count: int = -1


class ShareSelectRequest(BaseModel):
    """POST /api/share/select — body."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(..., min_length=5, max_length=8)


class ShareSelectResponse(BaseModel):
    """Resolved share metadata + payload pointer."""

    code: str
    # 'text' or 'file'
    kind: Literal["text", "file"]
    name: str | None = None
    size: int | None = None
    text: str | None = None
    url: str | None = None
    content_type: str | None = None
    force_download: bool = False
    expired_at: str | None = None
    expired_count: int = -1
    used_count: int = 0
