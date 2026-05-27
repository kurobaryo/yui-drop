# API reference

> The live OpenAPI spec is served at `/api/openapi.json` and an interactive Swagger UI at `/api/_swagger`. The public-facing v1 API has a dedicated documentation page at [`/docs`](https://drop.leod.me/docs). This doc is the high-level contract for client implementations and reviewers.

All non-binary responses use the envelope `{ "code": 0, "message": "ok", "detail": ... }` where `code != 0` indicates an application-level error. Authentication is `Authorization: Bearer <jwt>` (admin endpoints only).

## Public

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health`        | Liveness probe |
| GET  | `/api/config`        | Public config blob consumed by the SPA on boot (app name, upload size cap, expiry options, turnstile site key if enabled, etc.) |
| GET  | `/api/openapi.json`  | OpenAPI spec |
| GET  | `/api/_swagger`      | Swagger UI (internal endpoints only — see `/docs` for the public v1 API) |

## Share

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/share/text`             | Create a text share. Body: `{ text, expire_value, expire_style }`. Returns `{ code }`. |
| POST   | `/api/share/file`             | Single-shot file upload (multipart/form-data). For small files only; large files should use one of the chunked paths below. |
| POST   | `/api/share/select`           | Resolve a pickup code. Body: `{ code }`. Returns metadata + (a) inline text, (b) presigned URL, or (c) a token-protected `/api/share/download` URL. |
| GET    | `/api/share/download`         | Token-protected download (used when storage backend can't presign). Query: `?code=…&key=…`. |

## Chunked upload (server-proxied)

Used when the storage backend can't issue presigned URLs (local FS, OneDrive simple, WebDAV).

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/chunk/upload/init`                          | `{ file_name, file_size, chunk_size, file_hash }` → `{ upload_id, total_chunks, uploaded_chunks }` (supports resume) |
| POST   | `/api/chunk/upload/{upload_id}/{chunk_index}`     | Upload one part (form field `chunk`) |
| GET    | `/api/chunk/upload/{upload_id}`                   | Session status + part list |
| POST   | `/api/chunk/upload/{upload_id}/complete`          | `{ expire_value, expire_style }` → `{ code, name }` |
| DELETE | `/api/chunk/upload/{upload_id}`                   | Cancel + cleanup |

## Multipart direct upload (S3 / R2)

Used when the storage backend is S3-compatible. Files stream from the browser directly to the bucket; the API only signs URLs and verifies completion.

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/presign/init`                                  | `{ file_name, file_size, content_type, expire_value, expire_style }` → `{ upload_id, key, part_size, parts_total }` |
| POST   | `/api/presign/{upload_id}/sign-part`                 | `{ part_number }` → `{ url, headers, expires_at }` (single-shot, signed `PUT`) |
| POST   | `/api/presign/{upload_id}/complete`                  | `{ parts: [{ part_number, etag }] }` → `{ code, name }`. Server `HEAD`s the object and rejects if declared size mismatches > 5%. |
| DELETE | `/api/presign/{upload_id}`                           | Cancel; calls `AbortMultipartUpload` on the bucket and removes the session row. |
| GET    | `/api/presign/{upload_id}`                           | Session status |

## Admin (require Bearer JWT)

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/admin/login`                              | `{ password }` → `{ token, token_type: "Bearer", expires_at }` |
| GET    | `/api/admin/dashboard`                          | `{ totalFiles, storageUsed, recycledFiles, sysUptime, today: {...}, yesterday: {...} }` |
| GET    | `/api/admin/file?page=&size=&keyword=&include_deleted=` | Paginated list |
| PATCH  | `/api/admin/file/{id}`                          | Update code/expiry/prefix/suffix |
| POST   | `/api/admin/file/{id}/restore`                  | Restore from recycle bin (clear `deleted_at`) |
| DELETE | `/api/admin/file/{id}?hard=true`                | Soft-delete by default; `hard=true` also removes the bucket object |
| DELETE | `/api/admin/recycle-bin`                        | Hard-delete all soft-deleted rows + bucket objects |
| GET    | `/api/admin/logs?page=&size=&action=&ip=`       | Access log query |
| GET    | `/api/admin/settings`                           | Full settings dict |
| PATCH  | `/api/admin/settings`                           | Partial update |

All admin endpoints are rate-limited (per-IP) and audit-logged.

## v1 (admin-issued keys)

A stable, externally-versioned REST surface for programmatic clients. All endpoints require `Authorization: Bearer yd_<key_id>_<secret>`, where keys are admin-issued and scoped to `upload` and/or `read`. Per-key quotas (`max_file_size`, `quota_daily_bytes`) are enforced.

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST   | `/api/v1/upload`                              | upload | Simple multipart/form-data upload (≤ simple-upload cap, default 10 MiB) |
| POST   | `/api/v1/upload/init`                         | upload | Begin a multipart presigned upload. Body: `{ file_name, file_size, content_type?, expire_value, expire_style }`. Returns `{ upload_id, key, part_size, parts_total, expires_at }`. |
| POST   | `/api/v1/upload/{upload_id}/sign-part`        | upload | Sign one part. Body: `{ part_number }`. Returns `{ url, headers, expires_at, part_number }`. |
| POST   | `/api/v1/upload/{upload_id}/complete`         | upload | Finalize: `{ parts: [{ part_number, etag }] }`. Returns the same shape as `/upload`. |
| DELETE | `/api/v1/upload/{upload_id}`                  | upload | Abort an in-progress multipart session. |
| GET    | `/api/v1/shares?limit&offset&status`          | read   | List shares created by the current key. `status` ∈ `active`, `expired`, `all`. |
| GET    | `/api/v1/shares/{code}`                       | read   | Inspect a single share. 404 if not owned by the current key. |

**Quota enforcement** is layered on top of the existing global rate limits:

- `max_file_size` — bytes; pre-upload check returns 4293 / HTTP 413 when exceeded.
- `quota_daily_bytes` — cumulative bytes in a UTC day, tracked in `api_key_usage`. Exhaustion returns 4292 / HTTP 429. Set to `0` for unlimited.
- `quota_per_minute` — reserved for future call-rate limiting; not enforced yet.

**Admin endpoints for key management** live under `/api/admin/api-keys`:

| Method | Path | Purpose |
|---|---|---|
| GET    | `/api/admin/api-keys`                          | List all issued keys (no plaintext, no hashes). |
| POST   | `/api/admin/api-keys`                          | Issue a new key. Returns the plaintext token **exactly once** in `detail.plaintext`. |
| GET    | `/api/admin/api-keys/{id}`                     | Fetch a single key by id. |
| PATCH  | `/api/admin/api-keys/{id}`                     | Update note / scopes / quotas / expiry. `clear_expires_at: true` clears the expiry. |
| DELETE | `/api/admin/api-keys/{id}`                     | Revoke a key (sets `revoked_at`). Subsequent revokes return 4002 / HTTP 409. |
| GET    | `/api/admin/api-keys/{id}/usage?days=N`        | 30-day default; returns a per-day rollup of `total_bytes` and `total_calls`. |

The plaintext token is bcrypt-hashed before persistence. The public 8-character `key_id` prefix appears in audit logs and the admin UI; the full plaintext is never recoverable after issuance.

## v1 error codes

| `code` | HTTP | Meaning |
|---|---|---|
| 4011 | 401 | Missing / invalid API key |
| 4012 | 401 | Key revoked or expired |
| 4031 | 403 | Insufficient scope (key lacks `upload` or `read`) |
| 4292 | 429 | Daily byte quota exhausted |
| 4293 | 413 | File exceeds `max_file_size` |
| 4040 | 404 | Share / upload session not found or not owned by this key |

## Error codes (legacy / internal)

| `code` | HTTP | Meaning |
|---|---|---|
| 0 | 200 | OK |
| 4001 | 400 | Invalid input |
| 4011 | 401 | Unauthorized / expired token |
| 4031 | 403 | Forbidden (e.g. retrieve too many failures) |
| 4041 | 404 | Code not found / expired / deleted |
| 4291 | 429 | Rate-limited |
| 5001 | 500 | Server error |
