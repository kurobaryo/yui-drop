# API reference

> The live OpenAPI spec is served at `/api/openapi.json` and an interactive Swagger UI at `/api/_swagger`. The public-facing v1 API has a dedicated documentation page at `/docs` on every instance. This doc is the high-level contract for client implementations and reviewers.

**Envelope.** Successful JSON responses use `{ "code": 2000, "message": "ok", "detail": ... }`; `code === 2000` means success. Errors are returned with a matching HTTP status and the body `{ "detail": { "code": <4-digit>, "message": "<machine-readable reason>", "detail": <object|null> } }`. Two exceptions sit outside that wrapper: rate-limit rejections (`429`, `{ "code": 4291, "message": "rate_limited", "detail": "..." }`) and Turnstile failures (`400`, `{ "code": 4003, "message": "turnstile_failed" }`).

**Auth.** Admin endpoints take `Authorization: Bearer <jwt>`; `/api/v1/*` takes `Authorization: Bearer yd_<key_id>_<secret>`.

**Ids.** In `/api/v1`, `share_id` and `file_id` are strings matching `^[A-Za-z0-9_-]+$`.

## Public

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health`        | Liveness probe |
| GET  | `/api/config`        | Public config blob consumed by the SPA on boot (app name, upload size cap, expiry options, turnstile site key if enabled, etc.) |
| GET  | `/api/config/upload` | Upload limits — see below |
| GET  | `/api/openapi.json`  | OpenAPI spec |
| GET  | `/api/_swagger`      | Swagger UI (internal endpoints only — see `/docs` for the public v1 API) |

`GET /api/config/upload` returns:

| Field | Meaning |
|---|---|
| `simple_upload_max_bytes` | Cap of the single-request upload paths (`/api/share/file`, `/api/v1/upload`). |
| `chunk_upload_max_bytes` / `chunk_upload_enabled` | Server-proxied chunked upload cap and switch. |
| `max_file_bytes` | Largest single file any upload path accepts: the smaller of `MAX_UPLOAD_BYTES` and `MAX_FILE_BYTES`. |
| `max_share_bytes` | Total-size cap of one multi-file share. `multi_total_max_bytes` reports the same value. |
| `max_files_per_share` | File-count cap of one multi-file share (default 200). |
| `v1_multipart_ttl_minutes` | Lifetime of an `/api/v1` upload session (default 360) — see [v1](#v1-admin-issued-keys). |
| `v1_features` | `{ "multi_send": true, "revoke": true, "owner_view": true }` — `/api/v1` capabilities this server provides. |

## Share

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/share/text`             | Create a text share. Body: `{ text, expire_value, expire_style }`. Returns `{ code, name, expired_at, expired_count }`. |
| POST   | `/api/share/file`             | Single-shot file upload (multipart/form-data). For small files only; large files should use one of the chunked paths below. |
| POST   | `/api/share/select`           | Pick up a code — see below. |
| GET    | `/api/share/download/{code}`            | Download a single-file share — see [Downloads](#downloads). |
| GET    | `/api/share/download/{code}/{file_id}`  | Download one file of a multi-file share — see [Downloads](#downloads). |
| GET    | `/api/share/download?token=…`           | Download through a JWT-signed storage token (local-backend `get_object_url` links). |

**`POST /api/share/select`** — body `{ code, turnstile_token? }`. Consuming: decrements `expired_count` (unless unlimited, `-1`) and increments `used_count`. Returns `{ code, kind, name, size, text, url, content_type, force_download, expired_at, expired_count, used_count }` where:

- `kind: "text"` — the body is inline in `text`; `url` is null.
- `kind: "file"` — `url` is a signed same-origin download path, `/api/share/download/{code}?t=…`.
- `kind: "multi"` — `text` holds the optional note, plus `file_count`, `total_size` and `files: [{ file_id, order, name, size, url, content_type, force_download }]`, each `url` signed for that file.

Errors: `404 code_not_found` / `code_expired`; `404 share_not_finalized` while the sender of a multi-file share is still uploading (nothing is spent and it does not count as a failure); `403 ip_banned` (code 4030) after `RATE_LIMIT_RETRIEVE_FAILS_PER_HOUR` failed lookups from one IP within an hour, for `RETRIEVE_BAN_DURATION_MIN`.

## Downloads

`GET /api/share/download/{code}` and `GET /api/share/download/{code}/{file_id}` stream the file from this server (never a redirect to the bucket). Query parameters:

- `t` — signed download token. Every URL handed out by a pickup (`/api/share/select`, `/api/v1/pickup`) or to the owner (`/api/v1` upload responses, list/detail, `include=content`) carries one. It is bound to the share and file and valid for `DOWNLOAD_TOKEN_TTL_MIN` (default 15) minutes.
- `dl=1` — answer with `Content-Disposition: attachment` instead of `inline`. Combine freely with `t`.

Access is checked once, when the download starts (a running download is never cut off):

- **With a valid token** the file is served unless the share was revoked or deleted — even if the pickup that minted the token used the share's last count, or its time ran out meanwhile. The token's lifetime is the grace window.
- **Without a valid token** (missing or invalid — both treated the same): with `DOWNLOAD_TOKEN_MODE=counted` (default) only a live share limited purely by time (`expired_count == -1`) is served; count-limited shares are refused. With `DOWNLOAD_TOKEN_MODE=all` nothing is served.
- A multi-file share's files are only served once it is finalized and the file is complete.

Every refusal is the same `404` body, `{"detail":{"code":4040,"message":"code_not_found","detail":null}}`, and counts towards the same per-IP failure ban as pickup; a banned IP gets the pickup ban response (`403 ip_banned`). The routes are rate limited per IP: `RATE_LIMIT_DOWNLOAD_PER_MIN` (default 60) for unsigned requests, `RATE_LIMIT_DOWNLOAD_SIGNED_PER_MIN` (default 600) for requests with a valid token.

A share whose pickup count ran out is removed by the retention sweeper only after its last pickup's tokens have expired.

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

Used when the storage backend is S3-compatible. Files stream from the browser directly to the bucket; the API only signs URLs and verifies completion. Sessions live `MULTIPART_SESSION_TTL_MIN` (default 60) minutes.

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/presign/init`                                  | `{ file_name, file_size, content_type, expire_value, expire_style }` → `{ upload_id, key, part_size, parts_total, expires_at }` |
| POST   | `/api/presign/{upload_id}/sign-part`                 | `{ part_number }` → `{ url, headers, expires_at }` (single-shot, signed `PUT`) |
| POST   | `/api/presign/{upload_id}/complete`                  | `{ parts: [{ part_number, etag }] }` → `{ code, name, size, expired_at, expired_count }`. Server `HEAD`s the object and rejects if declared size mismatches > 5%. |
| DELETE | `/api/presign/{upload_id}`                           | Cancel; calls `AbortMultipartUpload` on the bucket and removes the session row. |
| GET    | `/api/presign/{upload_id}`                           | Session status |

## Multi-file share (anonymous, used by the web UI)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/share/multi/init` | `{ declared_file_count, declared_total_size, expire_value, expire_style, text? }` → `{ share_id, code, upload_token, expired_at, expired_count }` |
| POST | `/api/share/multi/{share_id}/file/init` | Bearer `upload_token`. Declares one file; returns a chunk session to upload through `/api/chunk/upload/*`. |
| POST | `/api/share/multi/{share_id}/file/{file_id}/complete` | Bearer `upload_token`. Closes one file. |
| POST | `/api/share/multi/{share_id}/finalize` | Bearer `upload_token`. Opens the share for pickup. Idempotent. |

Limits are shared with the `/api/v1` multi-file flow: at most `MAX_FILES_PER_SHARE` files, `MAX_FILE_BYTES` per file, and one total cap (`max_share_bytes` in `/api/config/upload`). The note is at most `MAX_TEXT_BYTES` of UTF-8.

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
| GET    | `/api/v1/key`                                 | any    | Describe the calling key: `{ key_id, scopes, max_file_size, quota_daily_bytes }`. The secret is never returned. |
| POST   | `/api/v1/upload`                              | upload | Simple multipart/form-data upload (≤ simple-upload cap, default 10 MiB). Returns `{ code, name, size, expired_at, expired_count, url, short_url }`; `url` is a signed download URL. |
| POST   | `/api/v1/upload/init`                         | upload | Begin a multipart presigned upload. Body: `{ file_name, file_size, content_type?, expire_value, expire_style }`. Returns `{ upload_id, key, part_size, parts_total, expires_at }`. The session lives `V1_MULTIPART_SESSION_TTL_MIN` (default 360) minutes. |
| POST   | `/api/v1/upload/{upload_id}/sign-part`        | upload | Sign one part. Body: `{ part_number }`. Returns `{ url, headers, expires_at, part_number }`. |
| POST   | `/api/v1/upload/{upload_id}/complete`         | upload | Finalize: `{ parts: [{ part_number, etag }] }`. Returns the same shape as `/upload`, with the share's real `expired_at` / `expired_count`. |
| DELETE | `/api/v1/upload/{upload_id}`                  | upload | Abort an in-progress multipart session. |
| POST   | `/api/v1/share/text`                          | upload | Create a text share. Body: `{ text, expire_value?, expire_style? }`. Returns `{ code, name, size, expired_at, expired_count, url: null, short_url }`. Unlike the anonymous `/api/share/text`, the row is attributed to the calling key so it appears in `/api/v1/shares`. |
| POST   | `/api/v1/share/multi` …                       | upload | Multi-file share with an optional note — see below. |
| POST   | `/api/v1/pickup`                              | read   | Redeem a pickup code. Body: `{ code }`. Returns the same shape as `/api/share/select` with absolute, signed URLs. See the notes below. |
| GET    | `/api/v1/shares?limit&offset&status`          | read   | List shares created by the current key — see below. |
| GET    | `/api/v1/shares/{code}?include=content`       | read   | Inspect a single share. 404 if not owned by the current key. |
| DELETE | `/api/v1/shares/{code}`                       | upload | Revoke a share created by the current key. Returns `{ code, deleted: true }`. Pickup and every download URL answer 404 from then on. Another key's share, an unknown code and an already-deleted share all answer `404 share_not_found`. |

**Notes on `/api/v1/pickup`:**

- **Consuming.** It decrements `expired_count` and increments `used_count`, exactly like the public SPA pickup. To look at your own share without spending a pickup, use `GET /api/v1/shares/{code}?include=content`.
- **Not ownership-scoped.** Any valid code redeems with any key; possession of the code is the authorisation. This deliberately differs from `GET /api/v1/shares/{code}`, which only returns shares the calling key created.
- **Failure tracking is key-scoped, not IP-scoped.** v1 clients typically call through a server-side proxy, so they all share one source IP. Keying the retrieve-failure ban on the API key means one client mistyping codes locks out only that key, not every caller behind the proxy. The real client IP is still recorded in the access log.
- **URLs** are absolute and signed (see [Downloads](#downloads)): they work without credentials for `DOWNLOAD_TOKEN_TTL_MIN` minutes after the pickup, even if that pickup used the last count.
- A multi-file share whose sender hasn't finalized yet answers `404 share_not_finalized` without spending anything.

### Share list and detail

`GET /api/v1/shares` — `status` ∈ `active` (default), `expired`, `all`. Rows are newest first:

```json
{ "code": "123456", "name": "a.pdf", "size": 1024, "kind": "file", "status": "active",
  "expired_at": "2026-10-13T12:00:00+00:00", "expired_count": -1, "used_count": 0,
  "created_at": "2026-10-06T12:00:00+00:00",
  "url": "https://<host>/api/share/download/123456?t=…", "short_url": "https://<host>/s/123456" }
```

- `status` is `active`, `expired` (time or count ran out, or removed by the sweeper) or `revoked`.
- `status=expired` / `all` also return shares removed by the sweeper or revoked within the last `SHARE_HISTORY_DAYS` (default 30) days. Those rows are metadata only: `url` is null and their content is gone.
- `url` is set for live single-file shares only, minted with a fresh token on every request, so the owner can preview without spending a pickup. Text shares and multi-file shares have `url: null`.
- `kind: "multi"` rows have `name: null`, `size: null` and add `file_count`, `total_size` and `has_note`.
- Multi-file shares still being uploaded are not listed.

`GET /api/v1/shares/{code}` returns one such row (also for revoked / swept shares within the history window). With `?include=content` the owner also gets what the share holds, without spending a pickup (`used_count` and `expired_count` are untouched):

- `text` — a text share's body, or a multi-file share's note (null if none);
- `files` (multi-file shares) — `[{ file_id, order, name, size, content_type, force_download, url }]`, each `url` absolute and signed.

A revoked / swept share has `text: null` and `files: []`.

### Multi-file share

Send several files — optionally with a note — under one pickup code. Every step is authorised by the API key that created the share; any other key gets `404 share_not_found`.

| Method | Path | Body → `detail` |
|---|---|---|
| POST   | `/api/v1/share/multi` | `{ declared_file_count: 1–200, declared_total_size: ≥1, expire_value, expire_style, text? }` → `{ share_id, code, expired_at, expired_count }`. The code is reserved now but can't be picked up before finalize. |
| POST   | `/api/v1/share/multi/{share_id}/files` | `{ name (≤512), size (≥1), content_type? }` → `{ file_id, upload_id, part_size, parts_total, expires_at }` |
| POST   | `/api/v1/share/multi/{share_id}/files/{file_id}/parts/{n}` | multipart/form-data field `chunk` → `{ part_number, etag }` (`etag` is null on non-S3 backends) |
| POST   | `/api/v1/share/multi/{share_id}/files/{file_id}/complete` | `{ parts: [{ part_number, etag \| null }] }` → `{ file_id, name, size }` |
| POST   | `/api/v1/share/multi/{share_id}/finalize` | → the share entry, exactly like `GET /api/v1/shares/{code}` (`kind: "multi"`, `file_count`, `total_size`, `has_note`, real `expired_at` / `expired_count`, `url: null`). Idempotent. |
| DELETE | `/api/v1/share/multi/{share_id}` | → `{ share_id, aborted: true }` |

- **Parts.** `part_size` is 6 MiB (6291456), or the file size for smaller files; `parts_total = ceil(size / part_size)`. Parts are numbered from 1; every part but the last must be exactly `part_size` bytes. On S3-compatible storage each part is forwarded straight to the bucket.
- **Limits.** At most `max_files_per_share` files; each file at most `max_file_bytes`; all files together at most `max_share_bytes` (see `/api/config/upload`); the key's `max_file_size` and `quota_daily_bytes` apply per file (usage is recorded when a file completes). The note is at most `MAX_TEXT_BYTES` (262144) UTF-8 bytes; a whitespace-only note counts as none.
- **Expiry** is counted from finalize, so time spent uploading doesn't shorten the share.
- **Session.** The whole share — create to finalize — must finish within `V1_MULTIPART_SESSION_TTL_MIN` (default 360) minutes (`expires_at`). After that the steps answer `410 upload_expired` and the sweeper discards the share.
- **Abort** releases the code, aborts unfinished uploads and deletes stored files. On a share that is already finalized it revokes it instead (as `DELETE /api/v1/shares/{code}`) and still answers `{ share_id, aborted: true }`.
- Before finalize, pickup answers `404 share_not_finalized` (nothing spent, no failure counted) and the files can't be downloaded.

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
| 4002 | 400 | Bad part: wrong size, too large, or no `chunk` field |
| 4003 | 400 | Part number out of range |
| 4004 | 400 | Part list doesn't match the upload (`parts_count_mismatch`, `missing_parts`, `etag_mismatch`) |
| 4007 | 400 | Multi-file share limits (`share_file_count_exceeded`, `share_quota_exceeded`) |
| 4011 | 401 | Missing / invalid API key |
| 4012 | 401 | Key revoked or expired |
| 4031 | 403 | Insufficient scope (key lacks `upload` or `read`) |
| 4040 | 404 | Share / file / upload session not found or not owned by this key |
| 4090 | 409 | Multi-file share state conflict (`share_already_finalized`, `file_already_complete`, `incomplete_files`, `no_files_registered`) |
| 4101 | 410 | Upload session expired |
| 4131 | 413 | Text / note too large |
| 4133 | 413 | File larger than `max_file_bytes` |
| 4292 | 429 | Daily byte quota exhausted |
| 4293 | 413 | File exceeds `max_file_size` |

## Error codes (anonymous / internal)

| `code` | HTTP | Meaning |
|---|---|---|
| 2000 | 200 | OK |
| 4001 | 400 | Invalid input (e.g. empty file, size mismatch) |
| 4003 | 400 | Turnstile check failed |
| 4011 | 401 | Unauthorized / expired token |
| 4030 | 403 | Forbidden — e.g. `ip_banned` after too many failed pickups / downloads |
| 4040 | 404 | Code not found / expired / deleted (`code_not_found`, `code_expired`, `share_not_finalized`) |
| 4291 | 429 | Rate-limited |
