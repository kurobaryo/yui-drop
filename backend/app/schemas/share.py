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


class ShareFileItem(BaseModel):
    """One entry in ``ShareSelectResponse.files`` for kind=multi."""

    file_id: int
    order: int
    name: str
    size: int
    url: str | None = None
    content_type: str | None = None
    force_download: bool = False


class ShareSelectResponse(BaseModel):
    """Resolved share metadata + payload pointer."""

    code: str
    # 'text' or 'file' or 'multi'
    kind: Literal["text", "file", "multi"]
    name: str | None = None
    size: int | None = None
    text: str | None = None
    url: str | None = None
    content_type: str | None = None
    force_download: bool = False
    expired_at: str | None = None
    expired_count: int = -1
    used_count: int = 0
    # kind=multi only
    total_size: int | None = None
    file_count: int | None = None
    files: list[ShareFileItem] | None = None


# ── Multi-file share lifecycle DTOs ─────────────────────────────────────────


class ShareMultiInitRequest(BaseModel):
    """POST /api/share/multi/init — body."""

    model_config = ConfigDict(extra="forbid")

    declared_file_count: int = Field(..., ge=1)
    declared_total_size: int = Field(..., ge=0)
    expire_value: int = Field(default=1, ge=1)
    expire_style: ExpireStyle = "day"


class ShareMultiInitResponse(BaseModel):
    share_id: int
    code: str
    upload_token: str
    expired_at: str | None = None
    expired_count: int = -1


class ShareFileInitRequest(BaseModel):
    """POST /api/share/multi/{share_id}/file/init — body."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=512)
    size: int = Field(..., ge=0)
    content_type: str | None = None
    # If True client wants a chunked-upload session (local backend); otherwise
    # for S3-style backends we mint a multipart presign payload.
    declared_chunked: bool = False
    # Optional: client-known chunk size for local-backend chunked uploads.
    chunk_size: int | None = Field(default=None, ge=1)


class ShareFileInitResponse(BaseModel):
    file_id: int
    # Local backend: upload_id of the chunk session. S3: upstream UploadId.
    upload_id: str
    # Local-backend chunked uploads use this URL template; for S3 it's None.
    upload_url: str | None = None
    chunk_size: int | None = None
    total_chunks: int | None = None
    # S3-style payload: enough info for the client to mint per-part presigns.
    presign_payload: dict | None = None


class ShareFileCompleteRequest(BaseModel):
    """POST /api/share/multi/{share_id}/file/{file_id}/complete — body."""

    model_config = ConfigDict(extra="forbid")

    # S3 / presign multipart parts (omitted for local-backend chunked flow).
    etag_list: list[dict] | None = None
    total_uploaded_bytes: int = Field(..., ge=0)


class ShareFileCompleteResponse(BaseModel):
    ok: bool = True
    size_verified: bool = True
    file_id: int
    size: int


class ShareFinalizeResponse(BaseModel):
    code: str
    expired_at: str | None = None
    file_count: int
    total_size: int

