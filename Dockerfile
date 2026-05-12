# ============================================================================
# Yui-Drop — single-stage container
# Builds the React frontend, then bundles the FastAPI backend and serves both.
# ============================================================================

# ─── 1. Frontend build ──────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-build
WORKDIR /build

# Enable pnpm via corepack — pin to a known-good version (pnpm@latest can
# ship as a "next" build with ERR_UNKNOWN_BUILTIN_MODULE on older node lines).
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY frontend/ ./
RUN pnpm build

# ─── 2. Backend runtime ─────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Avoid Python writing pyc, force unbuffered stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# OS deps: wget for healthcheck, libmagic for content-type sniffing
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Backend deps first (layer cache)
COPY backend/pyproject.toml backend/README.md* ./backend/
RUN pip install --upgrade pip && \
    pip install -e ./backend

# Backend source
COPY backend/ ./backend/

# Frontend build output → backend's static dir
COPY --from=frontend-build /build/dist ./frontend-dist

# Working data dir for SQLite + local-storage backend
RUN mkdir -p /app/data

EXPOSE 8000

# Healthcheck endpoint provided by FastAPI: GET /api/health → 200 OK
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:8000/api/health || exit 1

WORKDIR /app/backend
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
