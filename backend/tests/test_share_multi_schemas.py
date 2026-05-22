"""Regression tests for the multi-file share schemas.

Bug history
-----------
PR #11 added Turnstile gating to /api/share/text, /api/share/file,
/api/share/select, /api/presign/*, and /api/chunk/*. The frontend
``multiInit`` call shipped with a ``turnstile_token`` field, but the
backend ``ShareMultiInitRequest`` schema kept ``extra="forbid"`` and
never added the matching field — so every multi-file upload POSTed to
/api/share/multi/init with ``turnstile_token: null`` got rejected with
HTTP 422 ``extra_forbidden``. Single-file uploads worked because they
go through ``POST /api/share/file`` which uses ``Form()`` parameters
and accepted ``turnstile_token`` from the start.

These tests pin down the schema shape so the field can never go missing
again.
"""
from __future__ import annotations

import pytest

from app.schemas.share import (
    ShareFileCompleteRequest,
    ShareFileInitRequest,
    ShareMultiInitRequest,
)


class TestShareMultiInitRequest:
    """Pin down the bug fixed in fix/share-multi-init-turnstile-422."""

    def test_accepts_null_turnstile_token(self) -> None:
        """Frontend always sends turnstile_token, even when null. Must not 422."""
        req = ShareMultiInitRequest(
            declared_file_count=2,
            declared_total_size=100,
            expire_value=1,
            expire_style="day",
            turnstile_token=None,
        )
        assert req.turnstile_token is None
        assert req.declared_file_count == 2

    def test_accepts_string_turnstile_token(self) -> None:
        req = ShareMultiInitRequest(
            declared_file_count=1,
            declared_total_size=0,
            turnstile_token="0.fake-cf-token",
        )
        assert req.turnstile_token == "0.fake-cf-token"

    def test_accepts_missing_turnstile_token(self) -> None:
        """Legacy clients pre-Turnstile must keep working."""
        req = ShareMultiInitRequest(
            declared_file_count=1,
            declared_total_size=0,
        )
        assert req.turnstile_token is None

    def test_still_rejects_unknown_field(self) -> None:
        """extra='forbid' is intentional — only turnstile_token was missing."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as exc:
            ShareMultiInitRequest(
                declared_file_count=1,
                declared_total_size=0,
                bogus_field="x",
            )
        errors = exc.value.errors()
        assert any(e["type"] == "extra_forbidden" for e in errors)


class TestShareFileInitRequest:
    """Per-file init must keep working — no turnstile field expected here."""

    def test_minimal(self) -> None:
        req = ShareFileInitRequest(name="a.txt", size=10)
        assert req.declared_chunked is False
        assert req.chunk_size is None

    def test_chunked(self) -> None:
        req = ShareFileInitRequest(
            name="a.bin",
            size=100,
            declared_chunked=True,
            chunk_size=8,
        )
        assert req.declared_chunked is True
        assert req.chunk_size == 8


class TestShareFileCompleteRequest:
    """etag_list is list[dict] | None — pinning to prevent type drift."""

    def test_no_etag_list(self) -> None:
        req = ShareFileCompleteRequest(total_uploaded_bytes=1024)
        assert req.etag_list is None

    def test_etag_list_with_dicts(self) -> None:
        """S3 multipart parts come back as {part_number, etag} dicts."""
        req = ShareFileCompleteRequest(
            total_uploaded_bytes=1024,
            etag_list=[
                {"part_number": 1, "etag": "abc"},
                {"part_number": 2, "etag": "def"},
            ],
        )
        assert req.etag_list is not None
        assert len(req.etag_list) == 2
        assert req.etag_list[0]["part_number"] == 1
