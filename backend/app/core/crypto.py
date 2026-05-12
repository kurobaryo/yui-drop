"""AES-GCM encrypt/decrypt for at-rest secrets stored in ``settings_kv``.

Wire format: ``base64url(nonce(12) || ciphertext || tag(16))`` as a single
opaque string. Tag handling is delegated to ``cryptography``'s AESGCM
(combined ciphertext+tag output).

Key: ``settings.secrets_key`` — base64url-encoded, must decode to 32 bytes.

Operators can generate one with::

    python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings


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


def encrypt_secret(plaintext: str) -> str:
    """Encrypt ``plaintext`` and return ``base64url(nonce || ct+tag)``."""
    aes = AESGCM(_key())
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ct).decode()


def decrypt_secret(token: str) -> str:
    """Reverse of :func:`encrypt_secret`. Raises if the tag does not verify."""
    padded = token + "=" * (-len(token) % 4)
    raw = base64.urlsafe_b64decode(padded.encode())
    if len(raw) < 12 + 16:
        raise ValueError("ciphertext too short")
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(_key()).decrypt(nonce, ct, None).decode("utf-8")


__all__ = ["encrypt_secret", "decrypt_secret"]
