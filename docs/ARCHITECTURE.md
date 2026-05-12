# Architecture

> Status: planning — written before code lands. Each section will be expanded as the implementation stabilizes.

## Overview

Yui-Drop is a self-hostable file/text sharing service that produces a short numeric "pickup code" for every share. A recipient enters the code into the same web UI to retrieve the content. The product fits the same niche as [FileCodeBox](https://github.com/vastsa/FileCodeBox) and [Magic Wormhole](https://github.com/magic-wormhole/magic-wormhole), with a focus on:

- Self-hosting (single `docker compose up`).
- A modern Linear-style UI that works on mobile.
- Pluggable storage (local / S3 / R2 / OneDrive / WebDAV).
- Secure defaults and rate-limited endpoints.

## High-level flow

1. **Sender** drops a file in the browser. The browser asks the API to initialize an upload.
2. The API decides whether to use **multipart direct upload** (S3/R2 mode) or **server-proxied chunked upload** (local FS / OneDrive / WebDAV mode) and returns a session descriptor.
3. The browser uploads the file content (either directly to the bucket or through the API).
4. On completion the API records the share in the DB, returns a 6-digit pickup code.
5. **Recipient** types the code; the API resolves it to a download URL (presigned for S3/R2, or a token-protected `/share/download` for local/proxy).

## Components

### Frontend (`frontend/`)

| Layer | Tech |
|---|---|
| Build | Vite + TypeScript |
| Framework | React 18 |
| Routing | react-router v6 (BrowserRouter, no hash) |
| State | TanStack Query (server) + Zustand (UI) |
| Styling | Tailwind v3 + a small set of design tokens |
| i18n | react-i18next + browser-languagedetector |
| Icons | lucide-react |

Major routes:

- `/`             — landing page (3-tab interface: retrieve / send file / send text)
- `/s/:code`      — deep-link to a retrieve view, with code prefilled
- `/admin/login`  — admin entry
- `/admin/*`      — admin dashboard / file list / settings / logs / recycle bin

### Backend (`backend/`)

| Layer | Tech |
|---|---|
| Framework | FastAPI 0.115 + Uvicorn |
| ORM | SQLAlchemy 2.0 (async) |
| Migrations | Alembic |
| Validation | Pydantic v2 + pydantic-settings |
| Logging | structlog (JSON in prod) |
| Rate limiting | slowapi |
| S3 client | aioboto3 |
| Misc | python-multipart, python-magic |

Layout:

```
app/
├── main.py            ← FastAPI app, lifespan, middleware, static-mount
├── api/
│   ├── public.py      ← /api/config, /api/health
│   ├── share.py       ← /api/share/text, /api/share/file, /api/share/select
│   ├── chunk.py       ← /api/chunk/upload/{init,part,complete,abort,status}
│   ├── presign.py     ← /api/presign/{init,sign-part,complete,abort,proxy}
│   └── admin.py       ← /api/admin/*
├── core/
│   ├── config.py      ← pydantic-settings (loads .env)
│   ├── security.py    ← JWT + password hashing
│   ├── rate_limit.py  ← slowapi setup, key derivation
│   ├── codes.py       ← pickup-code generator (avoids low-entropy patterns)
│   ├── filenames.py   ← sanitization helpers
│   └── logging.py     ← structlog wiring
├── db/
│   ├── base.py        ← Declarative base, naming convention
│   └── session.py     ← async_sessionmaker, get_db dep
├── models/
│   ├── file_code.py
│   ├── upload_chunk.py
│   ├── multipart_session.py
│   ├── access_log.py
│   └── settings_kv.py
├── schemas/           ← Pydantic DTOs (one file per resource)
├── services/
│   ├── share.py
│   ├── chunk.py
│   ├── presign.py
│   ├── retention.py   ← sweeper job (soft-delete expired, abort orphan multiparts)
│   └── admin.py
└── storage/
    ├── base.py        ← StorageBackend interface
    ├── local.py
    ├── s3.py          ← presigned multipart upload support
    ├── onedrive.py
    └── webdav.py
```

### Storage abstraction

All storage backends implement:

```python
class StorageBackend(Protocol):
    async def init_upload(self, key: str, size: int) -> InitUploadResult: ...
    async def sign_part(self, key: str, upload_id: str, part: int) -> SignedPartUrl: ...
    async def complete_upload(self, key: str, upload_id: str, parts: list[Part]) -> CompletedUpload: ...
    async def abort_upload(self, key: str, upload_id: str) -> None: ...

    # For backends that don't support presigned PUT (local, OneDrive simple, WebDAV):
    # the API falls back to server-proxied chunk merging.
    async def server_write(self, key: str, src: AsyncIterator[bytes]) -> WriteResult: ...
    async def server_read(self, key: str, range: HttpRange | None) -> AsyncIterator[bytes]: ...

    async def get_object_url(self, key: str, ttl_s: int) -> str: ...
    async def delete(self, key: str) -> None: ...
    async def head(self, key: str) -> ObjectMeta: ...
```

The S3/R2 backend uses real S3 multipart upload (`CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload`). Other backends fall back to "client uploads chunks to API, API merges, then writes one object."

## Data model

See [`backend/app/models/`](../backend/app/models/) for the source of truth; high-level:

- `filecodes` — one row per share. Columns: `id, code, name, suffix, file_path, size, text, expired_at, expired_count, used_count, file_hash, is_chunked, upload_id, deleted_at, created_by_ip, created_by_ua, created_at`.
- `uploadchunks` — server-proxied chunk metadata.
- `multipartsessions` — S3-direct multipart state (upload_id, expires_at, parts, etc.).
- `access_logs` — every share-create and share-retrieve attempt, with IP + UA. Used for abuse triage; admin-only.
- `settings_kv` — single-row JSON config blob (everything the admin can change at runtime).

## Security

See [README#security](../README.md#security) for the threat-by-threat table. Implementation notes will land here.

## Retention & deletion

- **Expiry**: every share has an `expired_at` and/or `expired_count`. The sweeper job soft-deletes expired rows (`deleted_at = now()`) but leaves the bucket object intact.
- **Soft delete vs hard delete**: admin UI exposes both. Soft-deleted shares move to the recycle bin; hard delete removes both the DB row and the bucket object.
- **Orphan multiparts**: sessions older than `MULTIPART_SESSION_TTL_MIN` are auto-aborted by the sweeper, which also calls `AbortMultipartUpload` on the bucket to release any uploaded parts.
