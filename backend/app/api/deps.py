"""Shared FastAPI dependencies (admin auth, ...).

The admin auth dependency decodes the JWT minted by ``POST /api/admin/login``
and verifies the ``role`` claim. Failures are mapped to HTTPException with the
canonical 401/403 codes — the global rate limiter and admin-action audit log
are layered on top by the routes themselves.
"""
from __future__ import annotations

from typing import Any

from fastapi import Header, HTTPException, Request

from ..core.security import decode_jwt


async def require_admin(
    request: Request,
    authorization: str | None = Header(None),
) -> dict[str, Any]:
    """FastAPI dependency: extract+verify a Bearer JWT with ``role == 'admin'``.

    Returns the decoded JWT payload on success. Raises 401 for missing/invalid
    tokens and 403 if the token decodes but does not carry the admin role.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing_bearer")
    token = authorization[7:]
    try:
        payload = decode_jwt(token)
    except Exception as e:  # noqa: BLE001 — any jwt error → 401
        raise HTTPException(status_code=401, detail="invalid_token") from e
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="not_admin")
    # Stash on request.state so handlers can read the subject without redecoding.
    request.state.admin_payload = payload
    return payload
