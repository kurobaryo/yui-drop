"""Tests for the AES-GCM secret crypto helpers."""
from __future__ import annotations

import base64
import secrets

import pytest

from app.core import crypto


@pytest.fixture
def fresh_key(monkeypatch):
    raw = secrets.token_bytes(32)
    monkeypatch.setattr(
        crypto.settings,
        "secrets_key",
        base64.urlsafe_b64encode(raw).decode(),
        raising=True,
    )
    return raw


class TestRoundTrip:
    def test_round_trip(self, fresh_key):
        assert crypto.decrypt_secret(crypto.encrypt_secret("hello")) == "hello"

    def test_round_trip_unicode(self, fresh_key):
        plaintext = "ハロー · 世界 · 🔐"
        assert crypto.decrypt_secret(crypto.encrypt_secret(plaintext)) == plaintext

    def test_round_trip_long(self, fresh_key):
        plaintext = "x" * 4096
        assert crypto.decrypt_secret(crypto.encrypt_secret(plaintext)) == plaintext

    def test_each_encrypt_uses_fresh_nonce(self, fresh_key):
        a = crypto.encrypt_secret("same")
        b = crypto.encrypt_secret("same")
        assert a != b  # different nonces ⇒ different tokens
        assert crypto.decrypt_secret(a) == crypto.decrypt_secret(b) == "same"


class TestKeyValidation:
    def test_empty_key_raises(self, monkeypatch):
        monkeypatch.setattr(crypto.settings, "secrets_key", "", raising=True)
        with pytest.raises(RuntimeError, match="SECRETS_KEY is not configured"):
            crypto.encrypt_secret("x")

    def test_wrong_length_raises(self, monkeypatch):
        # 16 bytes instead of 32.
        bad = base64.urlsafe_b64encode(b"x" * 16).decode()
        monkeypatch.setattr(crypto.settings, "secrets_key", bad, raising=True)
        with pytest.raises(RuntimeError, match="32 bytes"):
            crypto.encrypt_secret("x")


class TestTamperDetection:
    def test_tampered_ciphertext_fails(self, fresh_key):
        token = crypto.encrypt_secret("secret")
        # Flip one byte in the middle of the token after base64-decoding.
        raw = bytearray(base64.urlsafe_b64decode(token.encode()))
        raw[20] ^= 0x01
        tampered = base64.urlsafe_b64encode(bytes(raw)).decode()
        with pytest.raises(Exception):
            crypto.decrypt_secret(tampered)
