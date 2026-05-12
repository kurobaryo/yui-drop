"""Tests for the XFF parser + audit-toggle gating in app.core.request_ip."""
from __future__ import annotations

from unittest.mock import MagicMock

from app.core.request_ip import _parse_xff, _raw_client_ip


def _fake_request(headers: dict[str, str], client_host: str | None = "127.0.0.1"):
    """Build a minimal duck-typed Request for the helpers under test."""
    req = MagicMock()
    req.headers = headers
    req.client = MagicMock()
    req.client.host = client_host
    if client_host is None:
        req.client = None
    return req


class TestParseXff:
    def test_single_value(self):
        assert _parse_xff("203.0.113.7") == "203.0.113.7"

    def test_rightmost_valid_picked(self):
        # Cloudflare prepends; the rightmost IP is the edge we trust.
        assert _parse_xff("10.0.0.1, 203.0.113.7, 1.2.3.4") == "1.2.3.4"

    def test_skips_garbage_at_end(self):
        # Some proxies append non-IP tokens like 'unknown'.
        assert _parse_xff("203.0.113.7, unknown") == "203.0.113.7"

    def test_ipv6(self):
        assert _parse_xff("2001:db8::1") == "2001:db8::1"

    def test_empty_returns_none(self):
        assert _parse_xff("") is None
        assert _parse_xff(",,") is None

    def test_only_invalid_returns_none(self):
        assert _parse_xff("not-an-ip, also-bad") is None

    def test_whitespace_stripped(self):
        assert _parse_xff("  203.0.113.7  ") == "203.0.113.7"


class TestRawClientIp:
    def test_uses_xff_when_present(self):
        req = _fake_request({"X-Forwarded-For": "10.0.0.1, 1.2.3.4"})
        assert _raw_client_ip(req) == "1.2.3.4"

    def test_falls_back_to_client_host(self):
        req = _fake_request({}, client_host="192.0.2.5")
        assert _raw_client_ip(req) == "192.0.2.5"

    def test_returns_none_when_no_client(self):
        req = _fake_request({}, client_host=None)
        assert _raw_client_ip(req) is None

    def test_xff_with_only_invalid_falls_back(self):
        req = _fake_request(
            {"X-Forwarded-For": "garbage, more-garbage"}, client_host="192.0.2.5"
        )
        assert _raw_client_ip(req) == "192.0.2.5"
