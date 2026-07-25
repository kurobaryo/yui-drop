"""Theme configuration DTOs (admin read/write + public read).

Mirrors ``app.services.admin_theme``. ``template`` and ``accent`` are
free-form slugs on purpose — validation is shape-only so adding a new
front-end template never requires touching the backend.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ThemeConfigResponse(BaseModel):
    """The resolved, active theme."""

    model_config = ConfigDict(extra="forbid")

    template: str
    mode: str
    accent: str
    accent_custom: str
    brand_name: str
    hero_title: str
    hero_subtitle: str
    default_lang: str
    logo_url: str
    lock_mode: bool


class ThemeConfigRequest(BaseModel):
    """Partial update — every field optional, ``None`` means "leave alone".

    Empty strings are meaningful (they clear an override back to the built-in
    default), so they are persisted rather than treated as absent.
    """

    model_config = ConfigDict(extra="forbid")

    template: str | None = Field(default=None, max_length=32)
    mode: str | None = Field(default=None, max_length=16)
    accent: str | None = Field(default=None, max_length=32)
    accent_custom: str | None = Field(default=None, max_length=16)
    brand_name: str | None = Field(default=None, max_length=200)
    hero_title: str | None = Field(default=None, max_length=200)
    hero_subtitle: str | None = Field(default=None, max_length=200)
    default_lang: str | None = Field(default=None, max_length=16)
    logo_url: str | None = Field(default=None, max_length=500)
    lock_mode: bool | None = None


__all__ = ["ThemeConfigRequest", "ThemeConfigResponse"]
