"""Short-link redirect for pickup codes.

Exposes ``GET /s/{code}`` as a server-side 302 redirect into the SPA's
pickup flow at ``/?code={code}``. This sits *outside* the ``/api`` prefix so
it shadows the SPA fallback for that specific path; every other ``/s/...``
URL continues to fall through to ``index.html`` (which would also handle the
deep link client-side, but the spec wants the redirect to make the canonical
share URL reflect what the user actually sees).
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from ..core.config import settings

router = APIRouter(tags=["shortlink"])

# Pickup codes are numeric (5–8 digits today). Refuse anything else early
# so we don't redirect arbitrary garbage into the SPA.
_CODE_RE = re.compile(r"^[0-9A-Za-z]{4,16}$")


@router.get("/s/{code}", include_in_schema=False)
async def shortlink_redirect(code: str, request: Request) -> RedirectResponse:
    """Redirect ``/s/{code}`` → ``{origin}/?code={code}`` (HTTP 302).

    The destination origin is:
        1. ``settings.app_url`` when it is non-empty (production canonical URL).
        2. ``request.base_url`` otherwise (covers local dev where ``app_url``
           is the default ``http://localhost:8000``).

    Note: we never auto-submit the pickup form on the client; the redirect
    only prefills the input so the user sees the code and decides to submit.
    """
    safe = code.strip()
    # Drop obviously hostile / oversized inputs.
    if not safe or not _CODE_RE.match(safe):
        # Fall back to the SPA root — the SPA's NotFound handler will own it.
        target = (settings.app_url or str(request.base_url)).rstrip("/") + "/"
        return RedirectResponse(url=target, status_code=302)
    base = (settings.app_url or str(request.base_url)).rstrip("/")
    return RedirectResponse(url=f"{base}/?code={safe}", status_code=302)
