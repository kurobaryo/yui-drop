#!/usr/bin/env bash
# install-yuidrop — install the yuidrop CLI to /usr/local/bin
#
# Run from the yui-drop repo root (or anywhere — script auto-resolves the repo):
#     sudo ./scripts/install-yuidrop.sh

set -euo pipefail

# ---------- colors ----------
if [[ -t 1 ]]; then
    C_RESET="\033[0m"; C_BOLD="\033[1m"
    C_BLUE="\033[34m"; C_GREEN="\033[32m"; C_YELLOW="\033[33m"; C_RED="\033[31m"
else
    C_RESET=""; C_BOLD=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi
_info() { printf "${C_BLUE}${C_BOLD}==>${C_RESET} %s\n" "$*"; }
_ok()   { printf "${C_GREEN}${C_BOLD} ✓${C_RESET} %s\n" "$*"; }
_warn() { printf "${C_YELLOW}${C_BOLD} !${C_RESET} %s\n" "$*" >&2; }
_err()  { printf "${C_RED}${C_BOLD} ✗${C_RESET} %s\n" "$*" >&2; }

# ---------- resolve repo dir ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$SCRIPT_DIR/yuidrop.sh" ]]; then
    _err "yuidrop.sh not found next to installer at: $SCRIPT_DIR"
    exit 1
fi
if [[ ! -d "$REPO_DIR/.git" ]]; then
    _warn "Resolved repo dir is not a git repo: $REPO_DIR"
    _warn "yuidrop will still install but 'update'/'rollback' will fail until the repo is a git checkout."
fi

# ---------- dependency check ----------
_info "Checking dependencies…"
MISSING=()
for bin in git docker curl; do
    if ! command -v "$bin" >/dev/null 2>&1; then
        MISSING+=("$bin")
    fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
    _warn "Missing dependencies: ${MISSING[*]}"
    _warn "yuidrop will install but some commands will fail until these are present."
else
    _ok "git, docker, curl all present"
fi
# Compose v2 check (warn only — installer should still complete)
if command -v docker >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1 || sudo -n docker compose version >/dev/null 2>&1; then
        _ok "docker compose (v2) available"
    elif command -v docker-compose >/dev/null 2>&1; then
        _warn "docker compose v2 not detected — falling back to legacy docker-compose v1"
    else
        _warn "Neither 'docker compose' v2 nor 'docker-compose' v1 detected"
    fi
fi

# ---------- install ----------
_info "Installing yuidrop CLI from: $REPO_DIR"

sudo cp "$SCRIPT_DIR/yuidrop.sh" /usr/local/bin/yuidrop
sudo chmod +x /usr/local/bin/yuidrop
_ok "Copied → /usr/local/bin/yuidrop"

echo "YUIDROP_REPO=$REPO_DIR" | sudo tee /etc/yuidrop.conf >/dev/null
sudo chmod 0644 /etc/yuidrop.conf
_ok "Wrote /etc/yuidrop.conf (YUIDROP_REPO=$REPO_DIR)"

echo
_ok "Installation complete."
printf "    Test with: ${C_BOLD}yuidrop status${C_RESET}\n"
printf "    Deploy with: ${C_BOLD}yuidrop update${C_RESET}\n"
printf "    Help: ${C_BOLD}yuidrop --help${C_RESET}\n"
