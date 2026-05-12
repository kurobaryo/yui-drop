<div align="center">

# Yui-Drop

### Self-hosted file-codebox with a 6-digit pickup code

English (default) · [中文](./README.zh.md) · [日本語](./README.ja.md)

[Live demo](https://drop.leod.me) · [Quick start](#quick-start)

</div>

---

## About

Yui-Drop is a modern, self-hostable "file-codebox": drop a file (or paste a text snippet), get a short 6-digit pickup code, share the code, done. No accounts, no links, no email — just a number you can read out over the phone.

It's a fresh rewrite inspired by [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox), built around a Linear-style UI, mobile-first layout, modern Python/JS stacks (FastAPI + React 18), tighter security defaults, and Cloudflare R2 / S3 multipart direct-upload so the API server never touches large files.

Yui-Drop 是一个现代的、可自部署的「文件快递柜」：丢入文件（或粘贴文字片段），得到 6 位数字取件码，把码告诉别人即可。无需注册账号、无需链接、无需邮件 —— 只是一个可以电话口述的数字。

灵感来自 [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) 的全新独立重写，聚焦于 Linear 风格 UI、移动端优先布局、现代化的 Python/JS 技术栈（FastAPI + React 18）、更严格的默认安全配置，以及 Cloudflare R2 / S3 多分块浏览器直传 —— API 服务器永远不接触大文件。

---

<div align="center">

🔒 **Secure by design** — TLS 1.3, AES-256 at-rest (R2 SSE), strict CSP, rate-limited
✨ **Modern stack** — React 18, FastAPI, SQLAlchemy 2.0, S3 multipart direct upload
📦 **Self-hosted** — single `docker compose up` deploys the whole stack

🔒 **默认安全** — 全链路 HTTPS (TLS 1.3)，存储侧 AES-256（R2 SSE），严格 CSP，速率限制
✨ **现代化技术栈** — React 18、FastAPI、SQLAlchemy 2.0、S3 多分块浏览器直传
📦 **自部署** — 单条 `docker compose up` 一键起服

</div>

---

## Features

- 🔑 **6-digit pickup code** — short, memorable, easy to share verbally
- 📁 **Files & text** — upload up to 10 GB, or paste a snippet
- 👁️ **In-browser preview** — images, PDFs, video, audio, text, markdown render inline; only download when you have to
- 🪣 **Pluggable storage** — local FS, S3 / Cloudflare R2 (with multipart direct upload), OneDrive, WebDAV
- ⚡ **Direct-to-bucket upload** — large files stream straight from the browser to the bucket; resumable, parallel parts, auto-retry on failure
- 🎨 **5 accent themes** + light / dark / system mode, all persisted per-device
- 🌐 **Tri-lingual UI** — English, 简体中文, 日本語; auto-detect, user-overridable
- 🛡️ **Security-first** — see [Security](#security) below
- 🗑️ **Soft delete + admin recycle bin** — expired or admin-removed shares are recoverable until the admin empties the bin

## Architecture

```
┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
│   React SPA  │◄────►│   FastAPI    │◄────►│   SQLite / DB    │
│  Vite + TS   │      │  Python 3.12 │      │  (metadata only) │
└──────┬───────┘      └──────┬───────┘      └──────────────────┘
       │                     │
       │  multipart-direct   │  presign / complete
       └─────────────┐ ┌─────┘
                     ▼ ▼
              ┌──────────────────┐
              │  Object Storage  │
              │  (R2 / S3 / FS)  │
              └──────────────────┘
```

- **Frontend** — React 18, Vite, TypeScript, Tailwind, react-i18next, TanStack Query, Zustand, lucide-react
- **Backend** — FastAPI, SQLAlchemy 2.0 (async), Alembic migrations, Pydantic v2, structlog, slowapi
- **Storage abstraction** — single `StorageBackend` interface; swap backends via `.env`
- **Files do not pass through the API server** when using S3/R2 — browser → bucket directly via presigned multipart URLs

## Quick start

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/kurobaryo/yui-drop/main/scripts/install.sh | bash
```

The installer will:
1. Clone the repo into `./yui-drop`
2. Generate a strong random `ADMIN_TOKEN` and `JWT_SECRET`
3. Write a starter `.env` (you'll edit it to point at your bucket if you want object storage)
4. Run `docker compose up -d --build`
5. Print the admin URL + token

Then open <http://localhost:8000> in your browser. Default storage backend is local FS — perfect for trying it out.

### Manual install

```bash
# 1. Clone
git clone https://github.com/kurobaryo/yui-drop.git
cd yui-drop

# 2. Generate secrets and write .env
cp .env.example .env
# edit .env — at minimum set ADMIN_TOKEN, JWT_SECRET, and (optionally) S3 / R2 credentials

# 3. Run
docker compose up -d --build

# 4. Open
open http://localhost:8000
```

### Development (without Docker)

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend (in another terminal)
cd frontend
pnpm install
pnpm dev   # → http://localhost:5173, proxies /api → :8000
```

## Configuration

All config is via environment variables (`.env`). The full list lives in [`.env.example`](./.env.example). Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_TOKEN` | *random* | Bootstrap admin password (hashed on first start) |
| `JWT_SECRET`  | *random* | Server-side JWT signing key |
| `STORAGE_BACKEND` | `local` | `local`, `s3`, `onedrive`, `webdav` |
| `S3_ENDPOINT_URL` | *(empty)* | e.g. `https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET_NAME`  | *(empty)* | The bucket holding uploaded files |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | *(empty)* | R2 / S3 credentials |
| `RATE_LIMIT_UPLOAD_PER_MIN` | `5` | Per-IP upload rate limit |
| `RATE_LIMIT_RETRIEVE_FAILS_PER_HOUR` | `20` | Per-IP failed-retrieve cap (auto-ban) |
| `MAX_UPLOAD_BYTES` | `10737418240` | Single file size cap (default 10 GiB) |
| `STORAGE_QUOTA_BYTES` | *(unlimited)* | Total storage quota across all shares |
| `EXPIRE_SWEEPER_INTERVAL_MIN` | `10` | How often the soft-delete sweeper runs |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | *(empty)* | Optional Cloudflare Turnstile bot protection |
| `ALLOWED_ORIGINS` | *(deploy host)* | CORS whitelist; never set this to `*` in prod |

Settings the admin can change at runtime (storage credentials, rate limits, UI labels, etc.) are stored in the DB and editable from `/admin/settings`. Sensitive secrets (`ADMIN_TOKEN`, `JWT_SECRET`) stay in `.env` and are never written back to the DB.

## Security

The user-facing badge says *"🔒 安全加密 · 匿名"* — here's what backs it.

### What's encrypted

- **In transit** — all client ↔ server traffic is HTTPS (TLS 1.3, recommend deploying behind Caddy / Nginx Proxy Manager with Let's Encrypt).
- **At rest in the bucket** — Cloudflare R2 and AWS S3 transparently encrypt every object with AES-256 server-side (SSE). No client work needed; the storage provider's keys are managed by them. This covers the "stolen disk" / "physical media seized" threat model.
- **Admin password** — stored as a salted hash; the raw token is only in `.env`.
- **JWT** — HS256 / RS256 signed; secret in `.env`.

> Yui-Drop does *not* do end-to-end encryption. The goal is fast, low-friction sharing for everyday files — a code you can speak over the phone. If you need provable zero-knowledge (server can't read your file), reach for a different tool: [Send](https://send.vis.ee), [Wormhole](https://wormhole.app), [Magic-Wormhole](https://github.com/magic-wormhole/magic-wormhole).

### What's defended against

| Threat | Defense |
|---|---|
| SQL injection | SQLAlchemy 2.0 parameterized queries throughout; no string concat in SQL |
| XSS (uploaded HTML / SVG) | SVG forced-download (not previewed); HTML files forced-download; text/markdown served as `text/plain` and rendered through DOMPurify |
| CSRF | Pure Bearer-JWT, no cookie auth, no ambient credentials |
| Brute-force pickup codes | Per-IP 20 failed retrievals → 1 h soft ban; codes generated avoiding low-entropy patterns (`123456`, `111111`, etc.) |
| Storage flooding | Per-IP upload limits (5/min, 30/h, 200/day); global storage quota (admin-configurable); 1 h orphan-multipart cleaner |
| Size lies in multipart | `complete` step HEADs the actual object and rejects if declared size ≠ real size > 5% |
| Admin brute-force | Per-IP 10/5min cap on `/admin/login` with exponential delay |
| Clickjacking / framing | `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Header injection in `Content-Disposition` | Filenames sanitized + RFC 5987 encoded |
| Open redirect | No user-supplied redirect targets anywhere |
| Path traversal | Filenames sanitized (no `..`, no control chars, no Windows reserved names); file paths derived from server-side UUIDs, never trusted user input |

Bot protection via Cloudflare Turnstile is shipped but **off by default** — toggle it on from the admin UI once you've configured the site key + secret in `.env`.

### Logging & retention

- **Access logs include client IP and User-Agent** for abuse triage; admin can query them from `/admin/logs`.
- **Soft delete** — expired or admin-removed shares are flagged `deleted_at` but the bucket object is kept. The admin can restore from the recycle bin or hard-delete (which removes the bucket object too).
- **Automatic sweeper** runs every `EXPIRE_SWEEPER_INTERVAL_MIN` minutes; expired rows become soft-deleted, orphan multipart sessions are aborted.

## Repository layout

```
yui-drop/
├── README.md              ← English (this file, default)
├── README.zh.md           ← 中文
├── README.ja.md           ← 日本語
├── LICENSE                ← MIT
├── docker-compose.yml     ← single-command deploy
├── .env.example           ← all configurable env vars, with comments
├── scripts/
│   ├── install.sh         ← one-line install script
│   └── ...                ← ops helpers
├── backend/               ← Python · FastAPI · SQLAlchemy 2.0
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── alembic.ini · alembic/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/           ← route modules
│   │   ├── core/          ← config, security, deps
│   │   ├── db/            ← session, base
│   │   ├── models/        ← SQLAlchemy models
│   │   ├── schemas/       ← Pydantic v2 DTOs
│   │   ├── services/      ← business logic
│   │   └── storage/       ← backend implementations
│   └── tests/
├── frontend/              ← React 18 · Vite · TypeScript
│   ├── package.json
│   ├── Dockerfile
│   ├── vite.config.ts · tailwind.config.ts · tsconfig.json
│   ├── public/
│   └── src/
│       ├── main.tsx · App.tsx
│       ├── routes/                ← route components
│       ├── components/ui/         ← Linear-style atoms
│       ├── components/motion/     ← animated accents
│       ├── pages/                 ← page-level components
│       ├── hooks/ · api/ · stores/
│       ├── i18n/locales/{en,zh-CN,ja}.json
│       └── styles/
└── docs/
    ├── ARCHITECTURE.md
    ├── API.md             ← REST contract + OpenAPI link
    └── DEPLOYMENT.md
```

## API

The backend serves an OpenAPI spec at `GET /api/openapi.json` and an interactive Swagger UI at `GET /api/docs`. See [`docs/API.md`](./docs/API.md) for the high-level contract.

## Roadmap

- [ ] Optional client-side encryption toggle (`?c=…&k=…` style)
- [ ] Custom pickup-code length (5–8 digits)
- [ ] WebPush / email expiry notifications
- [ ] Folder upload (auto-zip)
- [ ] Per-share password protection
- [ ] ClamAV scan hook

## Acknowledgements

Inspired by [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) — the original anonymous file-sharing service that pioneered the "share by code" idea. Yui-Drop is an independent rewrite focused on a Linear-style UI, mobile-first experience, modern Python/JS stacks, and tighter security defaults. No source code is shared with upstream.

## License

MIT — see [LICENSE](./LICENSE).
