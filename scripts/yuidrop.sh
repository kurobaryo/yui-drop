#!/usr/bin/env bash
# yuidrop — operational CLI for Yui-Drop
#
# Subcommands: update | status | logs [-f] | restart | rollback | --help | --version
#
# Reads repo path from /etc/yuidrop.conf (line: YUIDROP_REPO=/path/to/repo)
# or env $YUIDROP_REPO. Default: /opt/yui-drop/repo.

set -euo pipefail

YUIDROP_VERSION="0.2.1"
DEFAULT_REPO="/opt/yui-drop/repo"
CONF_FILE="/etc/yuidrop.conf"
CONTAINER_NAME="yui-drop"
HEALTH_URL="http://127.0.0.1:8000/api/health"

# ---------- pretty output ----------
if [[ -t 1 ]]; then
    _C_RESET="\033[0m"
    _C_BOLD="\033[1m"
    _C_BLUE="\033[34m"
    _C_GREEN="\033[32m"
    _C_YELLOW="\033[33m"
    _C_RED="\033[31m"
    _C_DIM="\033[2m"
else
    _C_RESET=""; _C_BOLD=""; _C_BLUE=""; _C_GREEN=""; _C_YELLOW=""; _C_RED=""; _C_DIM=""
fi

_info() { printf "${_C_BLUE}${_C_BOLD}==>${_C_RESET} %s\n" "$*"; }
_ok()   { printf "${_C_GREEN}${_C_BOLD} ✓${_C_RESET} %s\n" "$*"; }
_warn() { printf "${_C_YELLOW}${_C_BOLD} !${_C_RESET} %s\n" "$*" >&2; }
_err()  { printf "${_C_RED}${_C_BOLD} ✗${_C_RESET} %s\n" "$*" >&2; }
_dim()  { printf "${_C_DIM}%s${_C_RESET}\n" "$*"; }

# ---------- config resolution ----------
resolve_repo() {
    local repo=""
    if [[ -n "${YUIDROP_REPO:-}" ]]; then
        repo="$YUIDROP_REPO"
    elif [[ -r "$CONF_FILE" ]]; then
        # parse simple KEY=VALUE; ignore comments and blank lines
        repo="$(grep -E '^\s*YUIDROP_REPO\s*=' "$CONF_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
    fi
    if [[ -z "$repo" ]]; then
        repo="$DEFAULT_REPO"
    fi
    if [[ ! -d "$repo" ]]; then
        _err "Repo path not found: $repo"
        if [[ ! -r "$CONF_FILE" && -z "${YUIDROP_REPO:-}" ]]; then
            _err "yuidrop is not installed. From your yui-drop checkout run:"
            _err "    sudo ./scripts/install-yuidrop.sh"
        else
            _err "Set YUIDROP_REPO env var or edit $CONF_FILE"
        fi
        exit 1
    fi
    if [[ ! -d "$repo/.git" ]]; then
        _err "Not a git repo: $repo"
        exit 1
    fi
    printf "%s" "$repo"
}

# ---------- docker compose detection ----------
DC_CMD=()
detect_compose() {
    if ! command -v docker >/dev/null 2>&1; then
        _err "docker not found, install Docker first"
        exit 1
    fi
    if sudo docker compose version >/dev/null 2>&1; then
        DC_CMD=(sudo docker compose)
    elif command -v docker-compose >/dev/null 2>&1; then
        DC_CMD=(sudo docker-compose)
    else
        _err "Neither 'docker compose' (v2) nor 'docker-compose' (v1) is available"
        exit 1
    fi
}

require_curl() {
    if ! command -v curl >/dev/null 2>&1; then
        _err "curl not found, please install curl"
        exit 1
    fi
}

# ---------- helpers ----------
container_status() {
    local state
    state="$(sudo docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "absent")"
    printf "%s" "$state"
}

print_container_status() {
    local s
    s="$(container_status)"
    case "$s" in
        running) _ok    "Container ${CONTAINER_NAME}: ${s}" ;;
        absent)  _warn  "Container ${CONTAINER_NAME}: not present" ;;
        *)       _warn  "Container ${CONTAINER_NAME}: ${s}" ;;
    esac
}

health_check() {
    require_curl
    _info "Health check: ${HEALTH_URL}"
    local body http_code
    # write body to stdout, http code to stderr capture
    if body="$(curl -fsS --max-time 10 -w '\n%{http_code}' "$HEALTH_URL" 2>/dev/null)"; then
        http_code="$(printf '%s' "$body" | tail -n1)"
        body="$(printf '%s' "$body" | sed '$d')"
        printf '%s\n' "$body"
        if [[ "$http_code" == "200" ]]; then
            _ok "Healthy (HTTP $http_code)"
            return 0
        fi
        _warn "Unhealthy (HTTP $http_code)"
        return 1
    else
        _err "Health endpoint unreachable"
        return 1
    fi
}

alembic_upgrade() {
    _info "Running alembic upgrade head…"
    if sudo docker exec "$CONTAINER_NAME" python -m alembic upgrade head; then
        _ok "Migrations up to date"
    else
        _err "Alembic upgrade failed"
        return 1
    fi
}

# ---------- subcommands ----------
cmd_help() {
    cat <<EOF
${_C_BOLD}yuidrop${_C_RESET} — operational CLI for Yui-Drop (v${YUIDROP_VERSION})

${_C_BOLD}Usage:${_C_RESET}
    yuidrop <command> [options]

${_C_BOLD}Commands:${_C_RESET}
    update              git pull --ff-only, rebuild image, run migrations, health check
                        (use --force / -f to rebuild even when git is up to date)
    status              container state, /api/health JSON, disk usage, memory
    logs [-f]           show container logs (tail 200; -f to follow)
    restart             docker compose restart (no rebuild)
    rollback            git reset --hard HEAD~1, rebuild, migrate, health check
    --help, -h          show this help
    --version, -v       show version + repo HEAD SHA + container image SHA

${_C_BOLD}Configuration:${_C_RESET}
    Repo path is read from \$YUIDROP_REPO env var, then ${CONF_FILE}
    (line: YUIDROP_REPO=/path/to/repo), default ${DEFAULT_REPO}.

${_C_BOLD}Examples:${_C_RESET}
    yuidrop status
    yuidrop update
    yuidrop logs -f
EOF
}

cmd_version() {
    local repo head_sha image_sha
    repo="$(resolve_repo)"
    head_sha="$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
    image_sha="$(sudo docker inspect -f '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null | sed 's/^sha256://' | cut -c1-12 || true)"
    [[ -z "$image_sha" ]] && image_sha="not-running"
    printf "yuidrop %s\n" "$YUIDROP_VERSION"
    printf "  repo       : %s\n" "$repo"
    printf "  repo HEAD  : %s\n" "$head_sha"
    printf "  image SHA  : %s\n" "$image_sha"
}

cmd_update() {
    local repo new_count force=0
    repo="$(resolve_repo)"
    detect_compose

    # Support `yuidrop update --force` / `-f` for the case where the git tree
    # is already up to date but the running container is stale (e.g. you
    # pulled manually earlier, or a previous rebuild was skipped).
    for arg in "$@"; do
        case "$arg" in
            --force|-f) force=1 ;;
        esac
    done

    _info "Repo: $repo"

    if [[ -n "$(git -C "$repo" status --porcelain)" ]]; then
        _err "Working tree has local changes — refusing to update."
        _err "Stash, commit, or discard them first:"
        sudo -n true 2>/dev/null && git -C "$repo" status --short || git -C "$repo" status --short
        exit 1
    fi

    _info "Fetching origin/main…"
    git -C "$repo" fetch --prune origin main

    local local_sha remote_sha
    local_sha="$(git -C "$repo" rev-parse HEAD)"
    remote_sha="$(git -C "$repo" rev-parse origin/main)"

    if [[ "$local_sha" == "$remote_sha" ]] && [[ "$force" -eq 0 ]]; then
        _ok "Already up to date (HEAD = ${local_sha:0:12})"
        _info "Tip: run 'yuidrop update --force' to rebuild the container against the current source anyway"
        print_container_status
        return 0
    fi

    if [[ "$local_sha" != "$remote_sha" ]]; then
        new_count="$(git -C "$repo" rev-list --count HEAD..origin/main)"
        _info "Incoming commits (${new_count}):"
        git -C "$repo" --no-pager log --oneline --no-decorate "HEAD..origin/main"
        echo

        _info "Pulling fast-forward…"
        git -C "$repo" pull --ff-only origin main
    else
        _warn "Forced rebuild requested — repo already at ${local_sha:0:12}"
    fi

    _info "Rebuilding container…"
    ( cd "$repo" && "${DC_CMD[@]}" up -d --build )

    _info "Waiting 15s for container to settle…"
    sleep 15

    alembic_upgrade || true
    health_check || _warn "Health check did not return 200 — inspect 'yuidrop logs'"

    print_container_status
    _ok "Update complete"
}

cmd_status() {
    local repo
    repo="$(resolve_repo)"
    detect_compose

    _info "Repo: $repo"
    printf "  HEAD       : %s\n" "$(git -C "$repo" log -1 --pretty='%h %s (%cr)' 2>/dev/null || echo unknown)"
    printf "  Branch     : %s\n" "$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    echo

    _info "Container state"
    sudo docker ps -a --filter "name=^${CONTAINER_NAME}$" \
        --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}' || true
    echo

    local state
    state="$(container_status)"
    if [[ "$state" == "running" ]]; then
        _info "Container memory"
        sudo docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}' "$CONTAINER_NAME" || true
        echo
        _info "Health endpoint"
        health_check || true
        echo
    else
        _warn "Container not running — skipping memory + health"
        echo
    fi

    _info "Disk usage (repo dir)"
    du -sh "$repo" 2>/dev/null || true
    echo

    _info "Docker volumes for project"
    # Compose project name = lowercased basename of repo dir
    local project
    project="$(basename "$repo" | tr '[:upper:]' '[:lower:]')"
    sudo docker volume ls --filter "label=com.docker.compose.project=${project}" \
        --format 'table {{.Name}}\t{{.Driver}}' || true
    # Volume sizes (requires `docker system df -v`)
    sudo docker system df -v 2>/dev/null \
        | awk -v p="$project" '/^Local Volumes/{flag=1; next} flag && /^$/{flag=0} flag && $0 ~ p {print "  " $0}' \
        || true
}

cmd_logs() {
    detect_compose
    local follow=0
    if [[ "${1:-}" == "-f" || "${1:-}" == "--follow" ]]; then
        follow=1
    fi
    if [[ "$follow" -eq 1 ]]; then
        _info "Following logs for ${CONTAINER_NAME} (Ctrl-C to stop)…"
        exec sudo docker logs -f --tail 200 "$CONTAINER_NAME"
    else
        _info "Last 200 log lines for ${CONTAINER_NAME}"
        sudo docker logs --tail 200 "$CONTAINER_NAME"
    fi
}

cmd_restart() {
    local repo
    repo="$(resolve_repo)"
    detect_compose
    _info "Restarting ${CONTAINER_NAME} (no rebuild)…"
    ( cd "$repo" && "${DC_CMD[@]}" restart "$CONTAINER_NAME" )
    _ok "Restart issued"
    print_container_status
}

cmd_rollback() {
    local repo
    repo="$(resolve_repo)"
    detect_compose

    _info "Repo: $repo"

    if [[ -n "$(git -C "$repo" status --porcelain)" ]]; then
        _err "Working tree has local changes — refusing to rollback."
        exit 1
    fi

    local cur prev
    cur="$(git -C "$repo" rev-parse --short HEAD)"
    prev="$(git -C "$repo" rev-parse --short HEAD~1)"
    _warn "Rolling back: HEAD ${cur} → ${prev}"
    _info "Commit being reverted:"
    git -C "$repo" --no-pager log -1 --oneline HEAD
    echo

    git -C "$repo" reset --hard HEAD~1

    _info "Rebuilding container…"
    ( cd "$repo" && "${DC_CMD[@]}" up -d --build )

    _info "Waiting 15s for container to settle…"
    sleep 15

    alembic_upgrade || true
    health_check || _warn "Health check did not return 200 after rollback — inspect 'yuidrop logs'"

    print_container_status
    _ok "Rollback complete (now at ${prev})"
}

# ---------- dispatch ----------
main() {
    if [[ $# -eq 0 ]]; then
        cmd_help
        exit 0
    fi
    local sub="$1"; shift || true
    case "$sub" in
        update)            cmd_update "$@" ;;
        status)            cmd_status "$@" ;;
        logs)              cmd_logs "$@" ;;
        restart)           cmd_restart "$@" ;;
        rollback)          cmd_rollback "$@" ;;
        -h|--help|help)    cmd_help ;;
        -v|--version)      cmd_version ;;
        *)
            _err "Unknown command: $sub"
            echo
            cmd_help
            exit 2
            ;;
    esac
}

main "$@"
