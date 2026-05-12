"""Shared response Envelope and helpers.

Every API endpoint returns ``Envelope[T]`` so the frontend can rely on a single
shape: ``{ code, message, detail }``.

* ``code`` mirrors HTTP status for success (2000 = 200 OK) or a 4-digit app
  error code on failure (e.g. 4001 = size mismatch).
* ``message`` is human-readable (used for toast / log).
* ``detail`` is the actual payload for success, or an error dict for failure.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Envelope[T](BaseModel):
    """Standard response wrapper. ``detail`` may be ``None``."""

    model_config = ConfigDict(extra="forbid")

    code: int = Field(default=2000, description="App status code (HTTP-ish).")
    message: str = Field(default="ok")
    detail: T | None = None


def ok(detail: Any = None, message: str = "ok", code: int = 2000) -> dict[str, Any]:
    """Build a success envelope as a plain dict (cheap, no model validation)."""
    return {"code": code, "message": message, "detail": detail}


def fail(message: str, code: int = 4000, detail: Any = None) -> dict[str, Any]:
    """Build an error envelope as a plain dict."""
    return {"code": code, "message": message, "detail": detail}
