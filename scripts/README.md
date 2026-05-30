# Yui-Drop Operations Scripts

This directory contains the `yuidrop` operational CLI for managing a Yui-Drop
deployment running under Docker Compose, plus a small installer.

| File | Purpose |
| --- | --- |
| `yuidrop.sh` | Main CLI dispatcher (installed as `/usr/local/bin/yuidrop`). |
| `install-yuidrop.sh` | One-shot installer — copies the CLI to `/usr/local/bin` and writes `/etc/yuidrop.conf`. |
| `yui-drop-upload.sh` / `yui-drop-upload.py` | Client upload helpers (unrelated to operations). |

## Installation

From a fresh checkout of the Yui-Drop repo on the production host:

```bash
sudo ./scripts/install-yuidrop.sh
```

This will:

1. Copy `scripts/yuidrop.sh` to `/usr/local/bin/yuidrop` and `chmod +x`.
2. Write `YUIDROP_REPO=<absolute repo path>` to `/etc/yuidrop.conf`.
3. Warn (but not fail) about any missing dependencies.

After install, verify:

```bash
yuidrop --version
yuidrop status
```

## Requirements

- **Docker Engine** with the `docker compose` v2 plugin (recommended).
  Legacy `docker-compose` v1 is auto-detected as a fallback.
- **git**, **curl**, **bash 4+**.
- **sudo** access. Every `docker` invocation is prefixed with `sudo` because
  on the production VPS the deploy user is not in the `docker` group.
  `sudo NOPASSWD` is recommended for unattended `yuidrop update` runs;
  otherwise you'll be prompted for the password several times per command.

## Configuration

The CLI resolves the repo path in this order:

1. `$YUIDROP_REPO` environment variable, if set.
2. The `YUIDROP_REPO=…` line in **`/etc/yuidrop.conf`**.
3. Default: `/opt/yui-drop/repo`.

Example `/etc/yuidrop.conf`:

```ini
YUIDROP_REPO=/opt/yui-drop/repo
```

The container name is hard-coded to `yui-drop` (matches the Compose service).
Health endpoint is `http://127.0.0.1:8000/api/health`.

## Commands

```text
yuidrop update              Pull origin/main (fast-forward only), rebuild image,
                            run alembic migrations, hit the health endpoint.
                            Refuses to run if the working tree is dirty.

yuidrop status              Show: HEAD, branch, container state, /api/health JSON,
                            container memory + CPU, repo dir disk usage,
                            docker volume listing.

yuidrop logs [-f]           Show last 200 lines of container logs.
                            -f / --follow streams indefinitely.

yuidrop restart             docker compose restart of the yui-drop service.
                            No rebuild, no migrations.

yuidrop rollback            git reset --hard HEAD~1, rebuild image,
                            run alembic migrations, hit the health endpoint.
                            (Note: down-migrations are NOT automatic — if the
                            reverted commit added an irreversible schema change
                            you may need to restore from backup.)

yuidrop --help, -h          Usage.
yuidrop --version, -v       Script version + repo HEAD SHA + container image SHA.
```

### Examples

```bash
# Standard production deploy
yuidrop update

# Quick service bounce after a config change picked up at startup
yuidrop restart

# Tail logs while debugging
yuidrop logs -f

# Emergency: revert the last commit and rebuild
yuidrop rollback
```

## Uninstall

```bash
sudo rm /usr/local/bin/yuidrop /etc/yuidrop.conf
```

The repo checkout itself and the Docker containers/volumes are left untouched.

## Troubleshooting

### `docker not found, install Docker first`
The `docker` binary isn't on `PATH`. Install Docker Engine + Compose v2
(see https://docs.docker.com/engine/install/).

### `Repo path not found: /opt/yui-drop/repo`
Either `/etc/yuidrop.conf` is missing, `$YUIDROP_REPO` is unset, or the
configured path doesn't exist. Re-run `sudo ./scripts/install-yuidrop.sh`
from the actual repo checkout.

### `Working tree has local changes — refusing to update.`
`yuidrop update` and `rollback` refuse to run on a dirty tree because a
fast-forward pull would fail or a `reset --hard` would silently drop work.
On the production host this usually means root edited a tracked file in
place (e.g. `docker-compose.override.yml`). Either commit, stash, or
`git checkout --` the change before retrying.

### Health check fails after `update`
Check container logs: `yuidrop logs`. Common causes:
- Alembic migration failed → look for `alembic.runtime.migration` errors.
- New env var required but not set in `.env` or compose override.
- Port 8000 already in use by something else.

If the new build is broken, `yuidrop rollback` to revert the last commit
and rebuild.

### `sudo: a password is required`
Either run `yuidrop` from an interactive shell so you can type the
password, or configure `sudo NOPASSWD` for the deploy user (recommended
for unattended deploys).

### `Neither 'docker compose' (v2) nor 'docker-compose' (v1) is available`
Compose plugin is missing. On Debian/Ubuntu:

```bash
sudo apt-get install docker-compose-plugin
```

## Internals / hacking

`yuidrop.sh` is a single self-contained Bash script using `set -euo pipefail`.
Sections are separated with `# ---------- header ----------` banners.
Colored helpers `_info`, `_ok`, `_warn`, `_err` auto-disable when stdout
is not a TTY (so log capture stays clean).

Compose command selection lives in `detect_compose()` — it prefers
`sudo docker compose` and falls back to `sudo docker-compose`.

For a CI/dry-run override, set `YUIDROP_REPO` to a scratch checkout and
the container name in the script can be edited (look for the
`CONTAINER_NAME` variable near the top).
