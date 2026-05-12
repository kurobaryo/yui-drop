"""Pydantic v2 request/response DTOs.

Each resource gets its own module; ``common`` carries the response Envelope
shared by every endpoint.
"""
from .common import Envelope, fail, ok

__all__ = ["Envelope", "ok", "fail"]
