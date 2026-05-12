"""Pytest fixtures: SECRETS_KEY default + in-memory SQLite session."""
from __future__ import annotations

import asyncio
import base64
import os
import secrets

import pytest


def _ensure_secrets_key() -> None:
    """Populate SECRETS_KEY *before* the app modules load.

    ``app.main`` checks SECRETS_KEY at import time. We can't import anything
    from ``app`` until this is set.
    """
    if not os.environ.get("SECRETS_KEY"):
        os.environ["SECRETS_KEY"] = base64.urlsafe_b64encode(
            secrets.token_bytes(32)
        ).decode()


_ensure_secrets_key()


@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop so async fixtures share one loop."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
