#!/usr/bin/env bash
# ============================================================================
# Yui-Drop one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/kurobaryo/yui-drop/main/scripts/install.sh | bash
#
# What it does:
#   1. Clones (or updates) the repo into ./yui-drop
#   2. Generates strong random ADMIN_TOKEN + JWT_SECRET
#   3. Writes .env if missing
#   4. Runs `docker compose up -d --build`
#   5. Prints the admin URL + token
# ============================================================================
set -euo pipefail

REPO_URL="https://github.com/kurobaryo/yui-drop.git"
INSTALL_DIR="${YUI_DROP_DIR:-./yui-drop}"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info()  { color '1;36' "▸ $*"; }
ok()    { color '1;32' "✓ $*"; }
warn()  { color '1;33' "! $*"; }
fail()  { color '1;31' "✗ $*"; exit 1; }

# Dependencies
command -v git           >/dev/null 2>&1 || fail "git is required"
command -v docker        >/dev/null 2>&1 || fail "docker is required (https://docs.docker.com/get-docker/)"
docker compose version   >/dev/null 2>&1 || fail "docker compose v2 is required (use 'docker compose', not 'docker-compose')"

if command -v openssl >/dev/null 2>&1; then
    gen_secret() { openssl rand -hex 32; }
else
    gen_secret() { head -c 64 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48; }
fi

# ─── Clone / update ─────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull --ff-only
else
    info "Cloning $REPO_URL → $INSTALL_DIR"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ─── .env bootstrap ─────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    info "Generating .env from .env.example"
    cp .env.example .env

    ADMIN_TOKEN="$(gen_secret | head -c 32)"
    JWT_SECRET="$(gen_secret)"

    # Portable sed -i (works on both GNU sed and BSD/macOS sed)
    sed -i.bak \
        -e "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=${ADMIN_TOKEN}|" \
        -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
        .env
    rm -f .env.bak

    ok "Generated random ADMIN_TOKEN and JWT_SECRET in .env"
    warn "If you plan to use Cloudflare R2 / S3, edit .env now and set STORAGE_BACKEND=s3 plus the S3_* keys."
    warn "Default storage backend is local FS — fine for trying out, persisted in the 'yui-drop-data' docker volume."
    echo
    read -r -p "Press Enter to continue, or Ctrl-C to edit .env first..."
else
    info "Using existing .env"
fi

# ─── Build + run ────────────────────────────────────────────────────────────
info "Building and starting containers"
docker compose up -d --build

# Wait for healthcheck
info "Waiting for the service to become healthy..."
for _ in $(seq 1 30); do
    sleep 2
    if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
        ok "Service is up!"
        break
    fi
done

if ! curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
    warn "Service did not respond on /api/health within 60s — check 'docker compose logs -f' for details."
fi

# ─── Print summary ──────────────────────────────────────────────────────────
ADMIN_TOKEN_VAL="$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2-)"
echo
ok "Yui-Drop is running!"
echo "    URL:   http://localhost:8000"
echo "    Admin: http://localhost:8000/admin"
echo "    Token: ${ADMIN_TOKEN_VAL}"
echo
info "Next steps:"
echo "    1. Open the URL above in your browser."
echo "    2. To put it behind a domain with HTTPS, point a reverse proxy (Caddy / Nginx Proxy Manager) at port 8000."
echo "    3. Edit .env then 'docker compose up -d --build' to apply changes."
echo "    4. Logs:    docker compose logs -f"
echo "    5. Stop:    docker compose down"
echo "    6. Update:  git pull && docker compose up -d --build"
echo
