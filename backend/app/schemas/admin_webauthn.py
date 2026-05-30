"""Pydantic schemas for the admin WebAuthn / passkey endpoints.

Only the JSON request/response shells live here. The actual WebAuthn options
returned by ``webauthn.generate_*_options`` are serialised to plain dicts at
the route boundary — keeping the wire-format dependency-free on the frontend.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class WebauthnRegisterBeginResponse(BaseModel):
    """Public-key creation options returned to ``navigator.credentials.create``."""

    model_config = ConfigDict(extra="forbid")

    options: dict[str, Any]


class WebauthnRegisterCompleteRequest(BaseModel):
    """Raw ``PublicKeyCredential`` JSON produced by the authenticator."""

    model_config = ConfigDict(extra="allow")

    label: str | None = Field(default=None, max_length=128)
    credential: dict[str, Any]


class WebauthnCredentialOut(BaseModel):
    """Single row shape exposed in the admin credential list."""

    model_config = ConfigDict(extra="forbid")

    id: int
    label: str | None
    transports: list[str]
    created_at: datetime
    last_used_at: datetime | None
    sign_count: int


class WebauthnCredentialPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, max_length=128)


class WebauthnLoginBeginResponse(BaseModel):
    """Public-key request options returned to ``navigator.credentials.get``."""

    model_config = ConfigDict(extra="forbid")

    options: dict[str, Any]


class WebauthnLoginCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    credential: dict[str, Any]


__all__ = [
    "WebauthnRegisterBeginResponse",
    "WebauthnRegisterCompleteRequest",
    "WebauthnCredentialOut",
    "WebauthnCredentialPatch",
    "WebauthnLoginBeginResponse",
    "WebauthnLoginCompleteRequest",
]
