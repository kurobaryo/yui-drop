"""AES-GCM crypto helpers.

Two families of helpers live here:

1. **Opaque-string secrets** (``settings_kv`` rows): :func:`encrypt_secret`
   / :func:`decrypt_secret`. Wire format: ``base64url(nonce(12) || ct || tag(16))``
   as a single opaque string. Tag handling is delegated to ``cryptography``'s
   one-shot ``AESGCM`` (combined ciphertext+tag output).

2. **Streaming file encryption** (at-rest local file storage): a per-file
   data encryption key (DEK) is generated, wrapped under ``SECRETS_KEY`` and
   stored next to the row; the file itself is written through
   :func:`stream_encrypt` and read back through :func:`stream_decrypt`.

   On-disk layout (chosen for streaming reads)::

       [ 12 bytes nonce ][ 16 bytes GCM tag ][ ciphertext ... ]

   The tag-at-head layout (rather than tag-at-tail) is deliberate: the
   decryptor needs the tag *before* it can call ``finalize_with_tag``, and
   placing the tag at the head means we can stream from byte 28 onwards
   without first seeking to the end of the file. Cost: writers must
   reserve 16 bytes at the start and back-fill the tag after finalize.

   The high-level ``cryptography.hazmat.primitives.ciphers.aead.AESGCM``
   class is one-shot only, so streaming uses the lower-level ``Cipher`` API
   with ``AES``/``GCM`` directly (``encryptor.update`` per chunk, then
   ``encryptor.finalize`` + ``encryptor.tag``).

Key: ``settings.secrets_key`` — base64url-encoded, must decode to 32 bytes.

Operators can generate one with::

    python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
"""
from __future__ import annotations

import base64
import os
from collections.abc import Iterator
from typing import IO

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

# ── Constants ──────────────────────────────────────────────────────────────

NONCE_BYTES = 12
TAG_BYTES = 16
DEK_BYTES = 32
HEADER_BYTES = NONCE_BYTES + TAG_BYTES  # 28
_STREAM_CHUNK = 1024 * 1024  # 1 MiB read/encrypt chunk


def _key() -> bytes:
    """Decode the configured ``SECRETS_KEY`` and assert it's 32 bytes."""
    key_b64 = settings.secrets_key
    if not key_b64:
        raise RuntimeError(
            "SECRETS_KEY is not configured — refusing to encrypt/decrypt secrets."
        )
    # Accept both standard base64 and URL-safe base64 with or without padding.
    padded = key_b64 + "=" * (-len(key_b64) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode())
    except Exception:
        raw = base64.b64decode(padded.encode())
    if len(raw) != 32:
        raise RuntimeError("SECRETS_KEY must decode to 32 bytes for AES-256-GCM")
    return raw


# ── Opaque-string secrets (settings_kv) ────────────────────────────────────


def encrypt_secret(plaintext: str) -> str:
    """Encrypt ``plaintext`` and return ``base64url(nonce || ct+tag)``."""
    aes = AESGCM(_key())
    nonce = os.urandom(NONCE_BYTES)
    ct = aes.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ct).decode()


def decrypt_secret(token: str) -> str:
    """Reverse of :func:`encrypt_secret`. Raises if the tag does not verify."""
    padded = token + "=" * (-len(token) % 4)
    raw = base64.urlsafe_b64decode(padded.encode())
    if len(raw) < NONCE_BYTES + TAG_BYTES:
        raise ValueError("ciphertext too short")
    nonce, ct = raw[:NONCE_BYTES], raw[NONCE_BYTES:]
    return AESGCM(_key()).decrypt(nonce, ct, None).decode("utf-8")


# ── Per-file DEK wrapping ──────────────────────────────────────────────────


def generate_dek() -> bytes:
    """Return a fresh 32-byte data encryption key suitable for AES-256-GCM."""
    return os.urandom(DEK_BYTES)


def wrap_dek(dek: bytes) -> bytes:
    """Wrap ``dek`` under ``SECRETS_KEY``. Returns ``nonce || ct+tag``."""
    if len(dek) != DEK_BYTES:
        raise ValueError(f"DEK must be {DEK_BYTES} bytes")
    aes = AESGCM(_key())
    nonce = os.urandom(NONCE_BYTES)
    ct = aes.encrypt(nonce, dek, None)
    return nonce + ct


def unwrap_dek(wrapped: bytes) -> bytes:
    """Reverse of :func:`wrap_dek`. Raises on tag mismatch."""
    if len(wrapped) < NONCE_BYTES + TAG_BYTES:
        raise ValueError("wrapped DEK too short")
    nonce, ct = wrapped[:NONCE_BYTES], wrapped[NONCE_BYTES:]
    dek = AESGCM(_key()).decrypt(nonce, ct, None)
    if len(dek) != DEK_BYTES:
        raise ValueError("unwrapped DEK has wrong length")
    return dek


# ── Streaming AES-GCM (per-file) ───────────────────────────────────────────


def stream_encrypt(src: IO[bytes], dst: IO[bytes], dek: bytes) -> None:
    """Encrypt ``src`` into ``dst`` using ``dek`` in streaming AES-GCM.

    On-disk layout written to ``dst``: ``[nonce(12)][tag(16)][ciphertext]``.

    The tag isn't known until ``encryptor.finalize()`` runs, so we reserve
    ``HEADER_BYTES`` at the start, stream the ciphertext, then seek back and
    write nonce+tag into the reserved header. ``dst`` must therefore be a
    seekable binary stream.
    """
    if len(dek) != DEK_BYTES:
        raise ValueError(f"DEK must be {DEK_BYTES} bytes")
    nonce = os.urandom(NONCE_BYTES)
    encryptor = Cipher(algorithms.AES(dek), modes.GCM(nonce)).encryptor()

    # Reserve [nonce|tag] header — back-filled after finalize.
    header_pos = dst.tell()
    dst.write(b"\x00" * HEADER_BYTES)

    while True:
        chunk = src.read(_STREAM_CHUNK)
        if not chunk:
            break
        dst.write(encryptor.update(chunk))
    dst.write(encryptor.finalize())
    tag = encryptor.tag

    # Back-fill the header. Seek is required; if dst doesn't support it the
    # caller picked the wrong sink and the exception is the right answer.
    end_pos = dst.tell()
    dst.seek(header_pos)
    dst.write(nonce)
    dst.write(tag)
    dst.seek(end_pos)


def stream_decrypt(src: IO[bytes], dek: bytes) -> Iterator[bytes]:
    """Yield plaintext chunks from an encrypted ``src``.

    Raises ``cryptography.exceptions.InvalidTag`` on any tampering (wrong
    DEK, mutated ciphertext, mutated tag, truncated file). Header layout is
    the one written by :func:`stream_encrypt`: ``[nonce(12)][tag(16)][ct]``.
    """
    if len(dek) != DEK_BYTES:
        raise ValueError(f"DEK must be {DEK_BYTES} bytes")
    header = src.read(HEADER_BYTES)
    if len(header) < HEADER_BYTES:
        raise ValueError("encrypted file truncated: missing nonce/tag header")
    nonce = header[:NONCE_BYTES]
    tag = header[NONCE_BYTES:HEADER_BYTES]
    decryptor = Cipher(algorithms.AES(dek), modes.GCM(nonce, tag)).decryptor()
    while True:
        chunk = src.read(_STREAM_CHUNK)
        if not chunk:
            break
        out = decryptor.update(chunk)
        if out:
            yield out
    # finalize() raises InvalidTag on any mismatch.
    tail = decryptor.finalize()
    if tail:
        yield tail


__all__ = [
    "encrypt_secret",
    "decrypt_secret",
    "generate_dek",
    "wrap_dek",
    "unwrap_dek",
    "stream_encrypt",
    "stream_decrypt",
    "NONCE_BYTES",
    "TAG_BYTES",
    "DEK_BYTES",
    "HEADER_BYTES",
]
