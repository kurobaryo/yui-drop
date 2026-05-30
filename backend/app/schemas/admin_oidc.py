"""Pydantic DTOs for the admin OIDC endpoints."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class OidcConfigResponse(BaseModel):
    """``GET /api/admin/oidc/config`` — secret always masked."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool
    issuer: str
    client_id: str
    # Always ``"****"`` if a secret is stored; empty string otherwise.
    client_secret: str
    has_secret: bool
    scopes: str
    # Empty when unset — UI should fall back to ``effective_redirect_uri``.
    redirect_uri: str
    effective_redirect_uri: str
    provider_label: str
    allow_self_binding: bool


class OidcConfigUpdateRequest(BaseModel):
    """``PUT /api/admin/oidc/config`` — every field is optional.

    ``client_secret``:
        * omit (None) or send ``"****"`` → keep the existing encrypted value.
        * send a non-empty string → replace.

    Frontend convention: edit-clears the masked field, user types a new
    secret, and the new plaintext is sent up. To leave the secret alone,
    leave the field at its initial masked sentinel — the backend strips it.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    issuer: str | None = Field(default=None, max_length=512)
    client_id: str | None = Field(default=None, max_length=255)
    client_secret: str | None = Field(default=None, max_length=512)
    scopes: str | None = Field(default=None, max_length=255)
    redirect_uri: str | None = Field(default=None, max_length=512)
    provider_label: str | None = Field(default=None, max_length=64)
    allow_self_binding: bool | None = None


class OidcBindingItem(BaseModel):
    """One bound external identity, as returned by the bindings list."""

    model_config = ConfigDict(extra="forbid")

    id: int
    provider: str
    subject: str
    email: str | None
    display_name: str | None
    created_at: str
    last_login_at: str | None


class AdminAuthMethodsResponse(BaseModel):
    """Public probe consumed by the login page to render the right auth UI."""

    model_config = ConfigDict(extra="forbid")

    password_enabled: bool
    webauthn_enabled: bool
    oidc_enabled: bool
    oidc_provider_label: str
