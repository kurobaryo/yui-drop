"""Public, unauthenticated endpoints (health, config).

NOTE for follow-up subagents: the public router carries operational endpoints
that do not depend on storage or service layers — keep it stable. ``/health``
is implemented here directly so the dev loop stays self-contained.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..db.session import get_db
from ..schemas import ok
from ..services.admin_turnstile import resolve_turnstile_config
from ..storage.factory import resolve_storage_config

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """Liveness + DB connectivity probe.

    Returns ``{"status": "ok", "db": "ok"}`` on success; ``{"db": "fail"}``
    if the simple SELECT 1 round-trip fails.
    """
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        db_status = "fail"
    return {"status": "ok" if db_status == "ok" else "degraded", "db": db_status}


@router.get("/config")
async def public_config(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Public configuration consumed by the SPA on boot.

    Anything safe to expose to anonymous browsers — UI defaults, size caps,
    supported languages, optional Turnstile site key. Secrets (admin token,
    JWT secret, S3 keys) are NEVER returned here.

    ``storage_backend`` comes from the resolved settings_kv overlay so that the
    SPA picks the correct uploader strategy (presigned R2 direct vs server-
    proxied chunks) even when the admin reconfigured storage at runtime — the
    env-only ``settings.storage_backend`` would lie until the next restart.
    """
    storage_cfg = await resolve_storage_config(db)
    ts_cfg = await resolve_turnstile_config(db)
    # Mirror the existing site-key emission rule: only advertise the turnstile
    # surface when all three pieces (toggle on, public site key, server-side
    # secret) are in hand. Otherwise the SPA can't render the widget anyway,
    # so emit ``False`` for the per-action flags and let the frontend skip
    # both the widget and the token plumbing.
    ts_fully_configured = bool(
        ts_cfg.get("enabled") and ts_cfg.get("site_key") and ts_cfg.get("secret_key")
    )
    return ok(
        {
            "appName": settings.app_name,
            "appUrl": settings.app_url,
            "storage_backend": storage_cfg.backend,
            "maxUploadBytes": settings.max_upload_bytes,
            "maxTextBytes": settings.max_text_bytes,
            "pickupCodeLength": settings.pickup_code_length,
            "supportedLanguages": ["en", "zh-CN", "ja"],
            "expireOptions": [
                {"value": 1, "style": "hour"},
                {"value": 1, "style": "day"},
                {"value": 7, "style": "day"},
                {"value": 30, "style": "day"},
                {"value": 1, "style": "count"},
                {"value": 10, "style": "count"},
            ],
            # Turnstile site key only when both env keys are present.
            "turnstileSiteKey": (
                settings.turnstile_site_key
                if (settings.turnstile_site_key and settings.turnstile_secret_key)
                else None
            ),
            # Per-action gating advertised to the SPA. When turnstile is not
            # fully configured we surface ``False`` so the frontend skips the
            # widget instead of rendering a broken challenge.
            "turnstileProtectUpload": (
                bool(ts_cfg.get("protect_upload")) if ts_fully_configured else False
            ),
            "turnstileProtectPickup": (
                bool(ts_cfg.get("protect_pickup")) if ts_fully_configured else False
            ),
        }
    )


# ────────────────────────────────────────────────────────────────────────────
# GET /api/config/upload — public, read-only upload limits.
#
# Exposes the four knobs the SPA needs to choose between simple / chunked /
# presigned strategies (#7 + #8). These are NOT secrets: the same numbers
# would be revealed indirectly by a single rejected upload, so giving the
# UI a way to fail fast is a strict win.
# ────────────────────────────────────────────────────────────────────────────


@router.get("/config/upload")
async def public_upload_config(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return the admin-tunable upload limits + chunked-upload switch."""
    from ..services.admin_uploads import resolve_upload_limits

    out = await resolve_upload_limits(db)
    return ok(out)
