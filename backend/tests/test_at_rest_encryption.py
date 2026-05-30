"""Tests for at-rest encryption: DEK wrap/unwrap, streaming roundtrips,
LocalStorage encrypted I/O, S3 SSE header, and legacy-NULL compatibility.

These tests intentionally avoid full FastAPI integration — every layer they
exercise (``app.core.crypto``, ``app.storage.local``, ``app.storage.s3``) is
small enough to drive directly. Service-level wiring is covered by the
existing test suites via the new code paths in chunk/share.
"""
from __future__ import annotations

import asyncio
import base64
import io
import os
import secrets
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core import crypto

# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def fresh_key(monkeypatch):
    """Install a known SECRETS_KEY so wrap/unwrap is deterministic per-test."""
    raw = secrets.token_bytes(32)
    monkeypatch.setattr(
        crypto.settings,
        "secrets_key",
        base64.urlsafe_b64encode(raw).decode(),
        raising=True,
    )
    return raw


@pytest.fixture
def tmp_storage_root(tmp_path):
    return tmp_path / "storage"


# ── DEK wrap/unwrap ─────────────────────────────────────────────────────────


class TestDek:
    def test_generate_returns_32_bytes(self, fresh_key):
        dek = crypto.generate_dek()
        assert isinstance(dek, bytes)
        assert len(dek) == crypto.DEK_BYTES == 32

    def test_each_dek_is_unique(self, fresh_key):
        a = crypto.generate_dek()
        b = crypto.generate_dek()
        assert a != b

    def test_wrap_unwrap_roundtrip(self, fresh_key):
        dek = crypto.generate_dek()
        wrapped = crypto.wrap_dek(dek)
        assert crypto.unwrap_dek(wrapped) == dek

    def test_wrap_uses_fresh_nonce(self, fresh_key):
        dek = crypto.generate_dek()
        w1 = crypto.wrap_dek(dek)
        w2 = crypto.wrap_dek(dek)
        # Same DEK, fresh nonces → different wrappers but same unwrap result.
        assert w1 != w2
        assert crypto.unwrap_dek(w1) == crypto.unwrap_dek(w2) == dek

    def test_unwrap_rejects_wrong_master_key(self, fresh_key, monkeypatch):
        dek = crypto.generate_dek()
        wrapped = crypto.wrap_dek(dek)
        # Rotate SECRETS_KEY → unwrap must fail.
        monkeypatch.setattr(
            crypto.settings,
            "secrets_key",
            base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
            raising=True,
        )
        with pytest.raises(Exception):
            crypto.unwrap_dek(wrapped)


# ── Streaming AES-GCM round-trip ────────────────────────────────────────────


class TestStreamRoundTrip:
    def test_round_trip_small(self, fresh_key):
        plaintext = b"hello, world\n" * 17
        dek = crypto.generate_dek()
        encrypted = io.BytesIO()
        crypto.stream_encrypt(io.BytesIO(plaintext), encrypted, dek)
        # Header (nonce+tag) should not equal the plaintext head — quick
        # sanity check that something was actually written.
        encrypted.seek(0)
        on_disk = encrypted.read()
        assert on_disk[: crypto.HEADER_BYTES] != plaintext[: crypto.HEADER_BYTES]
        assert len(on_disk) == crypto.HEADER_BYTES + len(plaintext)

        encrypted.seek(0)
        recovered = b"".join(crypto.stream_decrypt(encrypted, dek))
        assert recovered == plaintext

    def test_round_trip_empty(self, fresh_key):
        dek = crypto.generate_dek()
        encrypted = io.BytesIO()
        crypto.stream_encrypt(io.BytesIO(b""), encrypted, dek)
        encrypted.seek(0)
        assert b"".join(crypto.stream_decrypt(encrypted, dek)) == b""

    def test_round_trip_10mib(self, fresh_key):
        # 10 MiB exercises the chunked read/update path.
        plaintext = os.urandom(10 * 1024 * 1024)
        dek = crypto.generate_dek()
        with tempfile.TemporaryFile() as enc_f:
            crypto.stream_encrypt(io.BytesIO(plaintext), enc_f, dek)
            enc_f.seek(0)
            recovered = b"".join(crypto.stream_decrypt(enc_f, dek))
        assert recovered == plaintext

    def test_wrong_dek_raises_invalid_tag(self, fresh_key):
        from cryptography.exceptions import InvalidTag

        plaintext = b"top secret payload"
        dek = crypto.generate_dek()
        wrong = crypto.generate_dek()
        encrypted = io.BytesIO()
        crypto.stream_encrypt(io.BytesIO(plaintext), encrypted, dek)
        encrypted.seek(0)
        with pytest.raises(InvalidTag):
            b"".join(crypto.stream_decrypt(encrypted, wrong))

    def test_tampered_ciphertext_raises_invalid_tag(self, fresh_key):
        from cryptography.exceptions import InvalidTag

        plaintext = b"x" * 256
        dek = crypto.generate_dek()
        encrypted = io.BytesIO()
        crypto.stream_encrypt(io.BytesIO(plaintext), encrypted, dek)
        raw = bytearray(encrypted.getvalue())
        # Flip a byte well past the header so we know we hit the ciphertext.
        raw[crypto.HEADER_BYTES + 10] ^= 0x01
        with pytest.raises(InvalidTag):
            b"".join(crypto.stream_decrypt(io.BytesIO(bytes(raw)), dek))

    def test_truncated_header_fails_cleanly(self, fresh_key):
        dek = crypto.generate_dek()
        # 27 bytes — one short of the 28-byte [nonce][tag] header.
        truncated = io.BytesIO(b"\x00" * (crypto.HEADER_BYTES - 1))
        with pytest.raises(ValueError, match="truncated"):
            list(crypto.stream_decrypt(truncated, dek))

    def test_missing_tag_fails_cleanly(self, fresh_key):
        """A header followed by ciphertext but with the tag zeroed out must fail."""
        from cryptography.exceptions import InvalidTag

        plaintext = b"y" * 64
        dek = crypto.generate_dek()
        encrypted = io.BytesIO()
        crypto.stream_encrypt(io.BytesIO(plaintext), encrypted, dek)
        raw = bytearray(encrypted.getvalue())
        # Zero out the tag bytes (offsets 12..28).
        for i in range(crypto.NONCE_BYTES, crypto.HEADER_BYTES):
            raw[i] = 0
        with pytest.raises(InvalidTag):
            b"".join(crypto.stream_decrypt(io.BytesIO(bytes(raw)), dek))


# ── LocalStorage encrypted I/O ─────────────────────────────────────────────


class TestLocalStorageEncrypted:
    @pytest.mark.asyncio
    async def test_round_trip_via_local_storage(self, fresh_key, tmp_storage_root):
        from app.storage.local import LocalStorage

        storage = LocalStorage(tmp_storage_root)
        plaintext = b"the quick brown fox jumps over the lazy dog" * 1000
        dek = crypto.generate_dek()

        key = "share/2026/05/30/test/sample.bin"
        await storage.server_write_encrypted(key, io.BytesIO(plaintext), dek)

        # On-disk bytes must differ from plaintext (sanity).
        on_disk = (tmp_storage_root / key).read_bytes()
        assert on_disk != plaintext
        assert len(on_disk) == crypto.HEADER_BYTES + len(plaintext)

        body = await storage.server_read_encrypted(key, dek)
        recovered = b""
        async for chunk in body:
            recovered += chunk
        assert recovered == plaintext

    @pytest.mark.asyncio
    async def test_legacy_null_wrapped_dek_still_readable(
        self, fresh_key, tmp_storage_root
    ):
        """Files written with the plain ``server_write`` path stay readable."""
        from app.storage.local import LocalStorage

        storage = LocalStorage(tmp_storage_root)
        plaintext = b"legacy unencrypted payload"
        key = "share/legacy/old.bin"
        await storage.server_write(key, io.BytesIO(plaintext), len(plaintext))

        # No wrapped_dek → caller uses ``server_read`` (the unencrypted path).
        body = await storage.server_read(key)
        recovered = b""
        async for chunk in body:
            recovered += chunk
        assert recovered == plaintext

    @pytest.mark.asyncio
    async def test_wrong_dek_via_local_storage_fails(self, fresh_key, tmp_storage_root):
        from cryptography.exceptions import InvalidTag

        from app.storage.local import LocalStorage

        storage = LocalStorage(tmp_storage_root)
        plaintext = b"private bytes"
        dek = crypto.generate_dek()
        wrong = crypto.generate_dek()
        key = "share/x/y.bin"
        await storage.server_write_encrypted(key, io.BytesIO(plaintext), dek)

        body = await storage.server_read_encrypted(key, wrong)
        with pytest.raises(InvalidTag):
            async for _ in body:
                pass


# ── S3 SSE header assertion ─────────────────────────────────────────────────


class TestS3Sse:
    @pytest.mark.asyncio
    async def test_create_multipart_upload_sends_sse_header(self):
        """``create_multipart_upload`` must include ``ServerSideEncryption=AES256``."""
        from app.storage.s3 import S3Storage

        storage = S3Storage(bucket="test-bucket", endpoint_url=None)

        mock_s3 = MagicMock()
        mock_s3.create_multipart_upload = AsyncMock(return_value={"UploadId": "abc"})

        # ``self._client()`` returns an async context manager — mock both
        # ``__aenter__`` and ``__aexit__`` so ``async with`` works.
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=mock_s3)
        cm.__aexit__ = AsyncMock(return_value=None)
        with patch.object(storage, "_client", return_value=cm):
            upload_id = await storage.init_multipart("some/key.bin", content_type="text/plain")

        assert upload_id == "abc"
        kwargs = mock_s3.create_multipart_upload.call_args.kwargs
        assert kwargs.get("ServerSideEncryption") == "AES256"
        assert kwargs.get("Bucket") == "test-bucket"
        assert kwargs.get("Key") == "some/key.bin"
        assert kwargs.get("ContentType") == "text/plain"

    @pytest.mark.asyncio
    async def test_put_object_sends_sse_header(self):
        from app.storage.s3 import S3Storage

        storage = S3Storage(bucket="test-bucket", endpoint_url=None)

        mock_s3 = MagicMock()
        mock_s3.put_object = AsyncMock(return_value={})

        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=mock_s3)
        cm.__aexit__ = AsyncMock(return_value=None)
        with patch.object(storage, "_client", return_value=cm):
            await storage.server_write("k.bin", io.BytesIO(b"hi"), 2)

        kwargs = mock_s3.put_object.call_args.kwargs
        assert kwargs.get("ServerSideEncryption") == "AES256"
        assert kwargs.get("Bucket") == "test-bucket"
        assert kwargs.get("Key") == "k.bin"


# ── Sanity: wrap_dek with wrong length is rejected ──────────────────────────


class TestInputValidation:
    def test_wrap_dek_wrong_length_rejects(self, fresh_key):
        with pytest.raises(ValueError, match="bytes"):
            crypto.wrap_dek(b"\x00" * 16)

    def test_stream_encrypt_wrong_dek_length_rejects(self, fresh_key):
        with pytest.raises(ValueError, match="bytes"):
            crypto.stream_encrypt(io.BytesIO(b""), io.BytesIO(), b"\x00" * 16)

    def test_stream_decrypt_wrong_dek_length_rejects(self, fresh_key):
        with pytest.raises(ValueError, match="bytes"):
            list(crypto.stream_decrypt(io.BytesIO(b"\x00" * 64), b"\x00" * 16))


# Keep linters happy about the optional asyncio import — pytest-asyncio
# fixtures handle the loop themselves.
_ = asyncio
_ = Path
