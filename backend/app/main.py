"""FastAPI application entrypoint.

Composes the few pieces of infrastructure owned by this skeleton:
    * structured logging
    * CORS (whitelist from settings.ALLOWED_ORIGINS, with a startup check
      that refuses '*' when serving over https)
    * security-headers middleware
    * slowapi rate limiter + 429 handler
    * /api/health (in app.api.public)
    * routers for share / chunk / presign / admin
    * lifespan-managed retention sweeper task
    * optional SPA fallback mount when ``../../frontend-dist`` exists
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from .api import admin as admin_api
from .api import chunk as chunk_api
from .api import presign as presign_api
from .api import public as public_api
from .api import share as share_api
from .api import share_multi as share_multi_api
from .core.config import settings
from .core.logging import configure_logging, get_logger
from .core.rate_limit import limiter
from .services.retention import sweeper_loop

configure_logging()
log = get_logger(__name__)


# ── Startup guard: SECRETS_KEY ──────────────────────────────────────────────


def _require_secrets_key_or_die() -> None:
    """Refuse to start without a usable ``SECRETS_KEY``.

    The key is needed any time the admin saves S3/R2 credentials through the
    admin UI (we AES-GCM-encrypt the secret access key before writing it to
    ``settings_kv``). We validate eagerly at startup so operators see a clear
    error before the first request, regardless of which storage backend is
    initially active — switching to S3 at runtime would otherwise fail with
    a confusing decrypt error on the next admin save.
    """
    key_b64 = settings.secrets_key or ""
    if not key_b64:
        raise RuntimeError(
            "SECRETS_KEY is empty. Generate one with "
            "`python -c \"import secrets, base64; "
            "print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())\"` "
            "and set it in your environment."
        )
    # Light sanity check: the value must decode to 32 bytes. We do it here
    # rather than in pydantic so the error path goes through configure_logging
    # and shows up in structured logs.
    import base64 as _b64
    padded = key_b64 + "=" * (-len(key_b64) % 4)
    try:
        raw = _b64.urlsafe_b64decode(padded.encode())
    except Exception as exc:
        raise RuntimeError(
            "SECRETS_KEY is not valid base64url. Re-generate it."
        ) from exc
    if len(raw) != 32:
        raise RuntimeError(
            f"SECRETS_KEY must decode to 32 bytes (got {len(raw)}). Re-generate it."
        )


_require_secrets_key_or_die()


# ── Security headers middleware ─────────────────────────────────────────────


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Set a conservative set of security response headers on every response.

    * Content-Security-Policy — default-src 'self', plus inline-data for
      images and inline styles (the SPA bundles its own CSS).
    * X-Frame-Options: DENY    — block all framing (clickjacking).
    * X-Content-Type-Options: nosniff — keep browsers honest about types.
    * Referrer-Policy: strict-origin-when-cross-origin.
    * Permissions-Policy: deny camera/microphone/geolocation by default.
    * Strict-Transport-Security: only emitted when serving over https
      (controlled by ``settings.is_https``).
    """

    DEFAULT_CSP = (
        "default-src 'self'; "
        "img-src 'self' data: blob:; "
        "media-src 'self' blob:; "
        "style-src 'self' 'unsafe-inline'; "
        # 'unsafe-inline' on script-src is required for the FOUC-prevention
        # inline script in the SPA's index.html (sets data-theme/data-accent
        # before the bundle loads). All actual app code ships in hashed
        # chunks under /assets/, served same-origin. The risk surface is the
        # single 25-line inline block in index.html. Tighten with a per-build
        # sha256 hash if you ship a CSP linter to your CI.
        "script-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; "
        "font-src 'self' data:; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        h = response.headers
        h.setdefault("Content-Security-Policy", self.DEFAULT_CSP)
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), interest-cohort=()",
        )
        # HSTS only when we know we're actually behind TLS — emitting it on
        # plain http would be useless and confusing.
        if settings.is_https:
            h.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


# ── CORS startup validation ─────────────────────────────────────────────────


def _validate_cors_or_die() -> list[str]:
    """Compute the CORS allow-list, refusing dangerous combinations.

    Rule: ``ALLOWED_ORIGINS=*`` combined with an ``https://`` APP_URL is a
    deployment mistake (credential-less cross-site reads from any origin).
    We refuse to start in that case.
    """
    origins = settings.allowed_origins_list
    if "*" in origins:
        if settings.is_https:
            raise RuntimeError(
                "ALLOWED_ORIGINS='*' is forbidden when APP_URL is https. "
                "Set ALLOWED_ORIGINS to an explicit comma-separated list."
            )
        # On plain http we still allow '*' (e.g. local dev / docker compose),
        # but warn loudly so it shows up in logs.
        log.warning("cors.wildcard_allowed_on_http")
        return ["*"]
    if not origins:
        origins = [settings.app_url]
    return origins


# ── Lifespan ────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App startup/shutdown: record start time and run the retention sweeper.

    The sweeper is a background asyncio task; on shutdown we cancel it and
    await its cancellation so structured logs flush cleanly.
    """
    app.state.startup_time = datetime.now(tz=UTC)

    # Prime the storage singleton from settings_kv so we pick up the admin-
    # configured backend (e.g. S3/R2) instead of caching env-only defaults on
    # the first request.
    try:
        from .db.session import get_db
        from .storage.factory import reload_storage

        async for _db in get_db():
            await reload_storage(db=_db)
            break
        log.info("app.lifespan.storage_primed")
    except Exception:
        log.exception("app.lifespan.storage_prime_failed")

    sweeper_task = asyncio.create_task(sweeper_loop(), name="retention-sweeper")
    log.info("app.lifespan.start", started_at=app.state.startup_time.isoformat())
    try:
        yield
    finally:
        sweeper_task.cancel()
        try:
            await sweeper_task
        except asyncio.CancelledError:
            pass
        except Exception:
            log.exception("app.lifespan.sweeper_shutdown_error")
        log.info("app.lifespan.stop")


# ── App factory ─────────────────────────────────────────────────────────────


def create_app() -> FastAPI:
    cors_origins = _validate_cors_or_die()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    # slowapi wiring (per-route limits land via decorators on the routers).
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limited(request: Request, exc: RateLimitExceeded):
        return JSONResponse(
            status_code=429,
            content={"code": 4291, "message": "rate_limited", "detail": str(exc)},
        )

    # Middleware stack. Order is outer-to-inner as added, so SecurityHeaders
    # runs LAST on the response path — exactly where we want to stamp headers.
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers — each router carries its own prefix.
    app.include_router(public_api.router)
    app.include_router(share_api.router)
    app.include_router(share_multi_api.router)
    app.include_router(chunk_api.router)
    app.include_router(presign_api.router)
    app.include_router(admin_api.router)

    # ── SPA fallback ────────────────────────────────────────────────────────
    # If a built frontend bundle sits next to the backend (``../../frontend-dist``
    # relative to this file), serve it: /assets via StaticFiles, every other
    # non-API GET route falls through to index.html so client-side routing works.
    frontend_dist = Path(__file__).resolve().parents[2] / "frontend-dist"
    if frontend_dist.exists():
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount(
                "/assets",
                StaticFiles(directory=str(assets_dir)),
                name="assets",
            )

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            # Don't swallow API routes or the static prefixes.
            if full_path.startswith(("api/", "api", "assets/", "assets")):
                raise HTTPException(status_code=404)
            # If the path matches a real file in the dist root (favicon, robots,
            # manifest, etc.), serve it directly. Otherwise fall through to
            # index.html for client-side routing.
            if full_path and "/" not in full_path:
                candidate = frontend_dist / full_path
                if candidate.is_file():
                    return FileResponse(str(candidate))
            index = frontend_dist / "index.html"
            if not index.exists():
                raise HTTPException(status_code=404)
            return FileResponse(str(index))

        log.info("spa.fallback.enabled", dist=str(frontend_dist))
    else:
        log.info("spa.fallback.disabled", dist=str(frontend_dist))

    log.info(
        "app.start",
        app=settings.app_name,
        storage=settings.storage_backend,
        url=settings.app_url,
    )
    return app


app = create_app()
