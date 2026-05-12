# API reference

> The live OpenAPI spec is served at `/api/openapi.json` and an interactive Swagger UI at `/api/docs`. This doc is the high-level contract for client implementations and reviewers.

All non-binary responses use the envelope `{ "code": 0, "message": "ok", "detail": ... }` where `code != 0` indicates an application-level error. Authentication is `Authorization: Bearer <jwt>` (admin endpoints only).

## Public

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health`        | Liveness probe |
| GET  | `/api/config`        | Public config blob consumed by the SPA on boot (app name, upload size cap, expiry options, turnstile site key if enabled, etc.) |
| GET  | `/api/openapi.json`  | OpenAPI spec |
| GET  | `/api/docs`          | Swagger UI |

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

## Error codes

| `code` | HTTP | Meaning |
|---|---|---|
| 0 | 200 | OK |
| 4001 | 400 | Invalid input |
| 4011 | 401 | Unauthorized / expired token |
| 4031 | 403 | Forbidden (e.g. retrieve too many failures) |
| 4041 | 404 | Code not found / expired / deleted |
| 4291 | 429 | Rate-limited |
| 5001 | 500 | Server error |
