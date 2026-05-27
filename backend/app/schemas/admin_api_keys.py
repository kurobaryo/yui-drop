"""Pydantic DTOs for the admin API-key management endpoints.

The route layer pairs these with ``app.services.admin_api_keys`` — request
bodies map onto service kwargs, and the list/detail responses share the
``AdminApiKeyListItem`` shape. ``AdminApiKeyCreateResponse`` is the only DTO
that ever carries the plaintext key, and only on the single create call.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Scope = Literal["upload", "read"]


class AdminApiKeyListItem(BaseModel):
    """One API-key row as returned by list/get/update/revoke. No secrets."""

    model_config = ConfigDict(extra="forbid")

    id: int
    key_id: str
    note: str | None
    scopes: list[Scope]
    quota_daily_bytes: int
    quota_per_minute: int
    max_file_size: int
    expires_at: str | None
    revoked_at: str | None
    last_used_at: str | None
    created_at: str
    created_by_admin: str | None
    is_active: bool


class AdminApiKeyCreateRequest(BaseModel):
    """Body for ``POST /api/admin/api-keys``."""

    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=255)
    scopes: list[Scope] = Field(
        default_factory=lambda: ["upload", "read"], min_length=1, max_length=2,
    )
    quota_daily_bytes: int = Field(default=5368709120, ge=0)
    quota_per_minute: int = Field(default=30, ge=1)
    max_file_size: int = Field(default=524288000, ge=1)
    expires_in_days: int | None = Field(default=365, ge=1)


class AdminApiKeyCreateResponse(AdminApiKeyListItem):
    """Same fields as list item + ``plaintext`` — shown ONCE on creation."""

    plaintext: str


class AdminApiKeyUpdateRequest(BaseModel):
    """Body for ``PATCH /api/admin/api-keys/{key_pk}``.

    Unset fields are left alone (the route layer uses ``model_dump(exclude_unset=True)``
    to detect this). ``clear_expires_at=True`` forces the row's ``expires_at`` to
    ``None`` — i.e. "never expires" — without having to put ``null`` into the JSON
    body where it could be ambiguous.
    """

    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=255)
    scopes: list[Scope] | None = Field(default=None, min_length=1, max_length=2)
    quota_daily_bytes: int | None = Field(default=None, ge=0)
    quota_per_minute: int | None = Field(default=None, ge=1)
    max_file_size: int | None = Field(default=None, ge=1)
    expires_at: datetime | None = None
    clear_expires_at: bool = False


class AdminApiKeyUsageDay(BaseModel):
    """One day's row in the usage time-series."""

    model_config = ConfigDict(extra="forbid")

    date: str
    total_bytes: int
    total_calls: int


class AdminApiKeyUsageResponse(BaseModel):
    """Body of ``GET /api/admin/api-keys/{key_pk}/usage``."""

    model_config = ConfigDict(extra="forbid")

    key_id: str
    days: list[AdminApiKeyUsageDay]
    totals: dict[str, int]
