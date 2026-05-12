"""Tests for the client-IP parsers + audit-toggle gating in app.core.request_ip."""
from __future__ import annotations

from unittest.mock import MagicMock

from app.core.request_ip import _parse_single_ip, _parse_xff, _raw_client_ip


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

    def test_leftmost_valid_picked(self):
        # The leftmost entry is the address closest to the original client;
        # each proxy hop appends its own peer address to the right.
        assert _parse_xff("1.2.3.4, 203.0.113.7, 10.0.0.1") == "1.2.3.4"

    def test_skips_garbage_at_start(self):
        # Some proxies prepend non-IP tokens like 'unknown'.
        assert _parse_xff("unknown, 203.0.113.7") == "203.0.113.7"

    def test_ipv6(self):
        assert _parse_xff("2001:db8::1") == "2001:db8::1"

    def test_empty_returns_none(self):
        assert _parse_xff("") is None
        assert _parse_xff(",,") is None

    def test_only_invalid_returns_none(self):
        assert _parse_xff("not-an-ip, also-bad") is None

    def test_whitespace_stripped(self):
        assert _parse_xff("  203.0.113.7  ") == "203.0.113.7"


class TestParseSingleIp:
    def test_valid_ipv4(self):
        assert _parse_single_ip("203.0.113.7") == "203.0.113.7"

    def test_valid_ipv6(self):
        assert _parse_single_ip("2001:db8::1") == "2001:db8::1"

    def test_whitespace_stripped(self):
        assert _parse_single_ip("  203.0.113.7  ") == "203.0.113.7"

    def test_invalid_returns_none(self):
        assert _parse_single_ip("not-an-ip") is None

    def test_empty_returns_none(self):
        assert _parse_single_ip("") is None
        assert _parse_single_ip("   ") is None


class TestRawClientIp:
    def test_prefers_cf_connecting_ip_over_xff(self):
        # Even if XFF has a different value, CF-Connecting-IP wins because
        # Cloudflare populates it with the real visitor IP.
        req = _fake_request(
            {
                "CF-Connecting-IP": "1.2.3.4",
                "X-Forwarded-For": "9.9.9.9, 10.0.0.1",
            }
        )
        assert _raw_client_ip(req) == "1.2.3.4"

    def test_falls_back_to_xff_when_cf_missing(self):
        req = _fake_request({"X-Forwarded-For": "1.2.3.4, 10.0.0.1"})
        assert _raw_client_ip(req) == "1.2.3.4"

    def test_invalid_cf_header_falls_back_to_xff(self):
        req = _fake_request(
            {
                "CF-Connecting-IP": "not-an-ip",
                "X-Forwarded-For": "1.2.3.4",
            }
        )
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
