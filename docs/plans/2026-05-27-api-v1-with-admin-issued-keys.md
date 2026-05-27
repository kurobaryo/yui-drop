# API v1 with Admin-Issued Keys — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Each task is sized to ≤ 12 file writes per subagent dispatch.

**Goal:** Add a public, key-authenticated REST API (`/api/v1/*`) to drop.leod.me so 主人 / Yui / future projects can upload files programmatically, plus an admin UI to issue/manage keys and a custom "washi-style" public docs page.

**Architecture:**
- **Backend**: New `api_keys` + `api_key_usage` tables + `verify_api_key` dependency in `core/api_auth.py`. New `/api/v1/*` router that reuses the existing `services/share.create_simple_file_share` for actual upload work (no duplicated share logic). Admin endpoints to mint/list/revoke keys.
- **Frontend**: New admin page `ApiKeys.tsx` (issue + list + revoke + edit-quota + view-usage). New public docs page `ApiDocs.tsx` styled with existing washi components (PaperTexture, Stamp, washi color tokens). New nav tab on home page linking to `/api/docs`.
- **Path conflict resolved**: FastAPI's auto-generated Swagger UI is currently at `/api/docs` — we move it to `/api/_swagger` so the SPA can own `/api/docs` for the custom docs page.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + argon2-cffi (already in deps via passlib? check). React + Vite + react-router (existing). Tailwind + washi tokens (existing).

**API key format:** `yd_<8char_id>_<32char_secret>` (41 chars total). `key_id` (the 8-char public prefix) is stored cleartext for log/list display; full key hashed with argon2.

**Default quotas (per key, admin-overridable):**
- `max_file_size`: 500 MB
- `quota_daily_bytes`: 5 GB
- `quota_per_minute`: 30 calls
- `expires_at`: +1 year from issuance (NULL means never)

**Scopes:** `upload` (POST /upload), `read` (GET /shares, GET /shares/{code}). Default new key = both.

**Endpoints (v1):**
- `POST /api/v1/upload` — multipart form: `file` + optional `expire_value` (int, ≥1, default 1) + `expire_style` (enum, default `day`) + `filename` (optional override). Returns `{code, name, size, expired_at, expired_count, url, short_url}`.
- `GET /api/v1/shares` — list shares created by this key. Query params: `limit` (default 50, max 200), `offset`, `status` (`active`|`expired`|`all`, default `active`).
- `GET /api/v1/shares/{code}` — single share details.

**Out of scope (explicitly):** No DELETE/revoke endpoint for shares (parity with existing UX — shares are fire-and-forget). No multi-file upload via v1 (single-file only for first release; multi-file can come in v1.1). No self-service key signup (admin-only issuance).

---

## Phase 0: Pre-flight verification (controller, no subagent)

Already done in the planning conversation:
- ✅ Verified `backend/app/main.py:224` — `docs_url="/api/docs"` is occupied by FastAPI swagger.
- ✅ Verified `backend/app/models/file_code.py` schema — needs `created_by_key_id` column (nullable, indexed).
- ✅ Verified `backend/app/api/admin.py` exists with `require_admin` Bearer JWT pattern at `backend/app/api/deps.py`.
- ✅ Verified `backend/app/services/share.py` exposes `create_simple_file_share` we can call from v1.
- ✅ Verified frontend has `pages/admin/{Layout,Dashboard,Files,Logs,Settings,Login}.tsx` and washi components at `variants/washi/`.
- ✅ Confirmed no `frontend/src/**/api*` files conflict (search returned 0 matches for "admin" → confirms `pages/admin/*` is the convention).

---

## Phase 1: Backend — DB schema + migrations

WRITE_FILE BUDGET: 3 new files, 1 modified.

### Task 1.1: Create `api_keys` SQLAlchemy model
- **Create**: `backend/app/models/api_key.py`
- Fields per the architecture section above.
- Index on `key_id` (lookup by public prefix), `revoked_at` (filter active).
- Register in `backend/app/models/__init__.py`.

### Task 1.2: Create `api_key_usage` model
- **Create**: `backend/app/models/api_key_usage.py`
- Columns: `id PK`, `api_key_id FK`, `date (DATE)`, `total_bytes BigInteger default 0`, `total_calls Integer default 0`.
- Unique constraint `(api_key_id, date)`.
- Register in `__init__.py`.

### Task 1.3: Add `created_by_key_id` to `FileCode`
- **Modify**: `backend/app/models/file_code.py` — add `created_by_key_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("api_keys.id"), nullable=True, index=True)`
- Migration handles the column add; nullable so existing rows are untouched.

### Task 1.4: Generate + write Alembic migration
- **Create**: `backend/alembic/versions/<rev>_add_api_keys.py`
- Tables: `api_keys`, `api_key_usage`, alter `filecodes` add column.
- Verify with `alembic upgrade head` against a fresh SQLite DB locally.

---

## Phase 2: Backend — Auth + v1 routes

WRITE_FILE BUDGET: 4 new files, 1 modified (main.py).

### Task 2.1: Create `core/api_auth.py`
- **Create**: `backend/app/core/api_auth.py`
- Exports:
  - `generate_api_key() -> tuple[str, str, str]` — returns `(full_plaintext, key_id, key_hash)`. Uses `secrets.token_urlsafe` (trimmed to 32 alphanumeric chars for the secret part).
  - `hash_api_key(plaintext: str) -> str` — argon2.
  - `verify_api_key_dependency` — FastAPI dep that parses `Authorization: Bearer yd_...`, looks up by `key_id`, argon2 verifies, checks `revoked_at`/`expires_at`, checks quota via `services/api_quota.py` (next task), returns the `ApiKey` row.
  - Custom exceptions returning `code/message` envelope (4011 invalid_key, 4012 revoked, 4013 expired, 4031 scope_denied, 4291 quota_minute, 4292 quota_daily, 4293 file_too_large).

### Task 2.2: Create `services/api_quota.py`
- **Create**: `backend/app/services/api_quota.py`
- Functions:
  - `check_and_record(db, api_key, *, bytes_used: int)` — atomic upsert into `api_key_usage` for today's date; raise `QuotaExceeded` if daily would be breached BEFORE recording.
  - `check_rate_limit(api_key)` — uses slowapi limiter keyed on `key_id` (delegate to existing `core/rate_limit.py`).
  - In-memory cache OK for rate-limit; persistent for daily bytes.

### Task 2.3: Create v1 schemas
- **Create**: `backend/app/schemas/v1.py`
- DTOs: `V1UploadResponse`, `V1ShareListItem`, `V1ShareListResponse`, `V1ShareDetailResponse`.
- All `model_config = ConfigDict(extra="forbid")` per project convention.

### Task 2.4: Create `api/v1.py` router
- **Create**: `backend/app/api/v1.py`
- Three endpoints. `POST /upload` calls `services.share.create_simple_file_share` then records bytes via `api_quota.check_and_record`.
- Set `FileCode.created_by_key_id = api_key.id` when calling the share service. (Service may need a small kwarg added — touch carefully.)
- Each endpoint depends on `verify_api_key_dependency` with explicit scope check.

### Task 2.5: Wire router + move swagger
- **Modify**: `backend/app/main.py`
  - Change `docs_url="/api/docs"` → `docs_url="/api/_swagger"` (preserves swagger for dev, frees `/api/docs` for SPA).
  - `app.include_router(v1_api.router)`.

---

## Phase 3: Backend — Admin key management endpoints

WRITE_FILE BUDGET: 2 new files, 1 modified.

### Task 3.1: Service layer
- **Create**: `backend/app/services/admin_api_keys.py`
- Functions: `list_keys`, `create_key (returns plaintext ONCE)`, `update_key`, `revoke_key`, `get_key_usage_history (last 30 days from api_key_usage)`.
- Audit log every mutation via `record_access` with `action=admin_action`.

### Task 3.2: Admin schemas
- **Create**: `backend/app/schemas/admin_api_keys.py`
- DTOs: `AdminApiKeyListItem`, `AdminApiKeyCreateRequest`, `AdminApiKeyCreateResponse (includes plaintext_key — emit once)`, `AdminApiKeyUpdateRequest`, `AdminApiKeyUsageResponse`.

### Task 3.3: Admin routes
- **Modify**: `backend/app/api/admin.py` — append 5 new routes (`GET /api-keys`, `POST /api-keys`, `PATCH /api-keys/{id}`, `DELETE /api-keys/{id}`, `GET /api-keys/{id}/usage`), all with `Depends(require_admin)`.

---

## Phase 4: Backend — Tests + local verification (controller)

WRITE_FILE BUDGET: 2 new test files.

### Task 4.1: Unit + integration tests
- **Create**: `backend/tests/test_api_v1.py` — happy paths (upload, list, get), auth failures (no key, bad key, revoked, expired, wrong scope), quota failures (file too big, daily exceeded), rate limit.
- **Create**: `backend/tests/test_admin_api_keys.py` — admin can issue, plaintext appears once, list shows no plaintext, update/revoke works, usage endpoint returns shape.
- Run `pytest backend/tests/test_api_v1.py backend/tests/test_admin_api_keys.py -v` — must all pass.

### Task 4.2: Controller smoke test
- Spin up local backend (`uvicorn app.main:app --reload --port 8000`), curl through real flow:
  1. Admin login → JWT
  2. Issue key → get plaintext
  3. Upload file via `Authorization: Bearer yd_...`
  4. Curl returned `url` → file downloads
  5. List shares via same key → entry appears
  6. Revoke key → upload now 401

---

## Phase 5: Frontend — Admin ApiKeys page

WRITE_FILE BUDGET: 4 new files, 2 modified.

### Task 5.1: API client + types
- **Create**: `frontend/src/lib/api/adminApiKeys.ts` — list/create/update/revoke/getUsage HTTP calls. Mirrors existing `lib/api/*` patterns.

### Task 5.2: ApiKeys page
- **Create**: `frontend/src/pages/admin/ApiKeys.tsx` — table view with columns (key_id prefix, note, scopes badges, quota summary, status badge, last_used, created_at, expires_at, actions).
- Actions per row: edit note/quota (opens Modal), view usage (opens Modal with 30-day chart — simple bar chart with divs, no chart lib), revoke (confirm Modal).

### Task 5.3: Issue-key flow
- **Create**: `frontend/src/pages/admin/ApiKeyIssueModal.tsx` — form: note (required), scopes (checkboxes), quota overrides (numeric inputs prefilled with defaults), expires_in_days (default 365, "Never" option).
- On submit → POST → response Modal shows plaintext key in monospace box with copy button + red warning banner: "🔒 这是该 key 唯一一次显示。关闭后将无法再次查看，请立即保存到 1Password。"

### Task 5.4: Edit-quota Modal
- **Create**: `frontend/src/pages/admin/ApiKeyEditModal.tsx` — note + quota override fields. PATCH on submit.

### Task 5.5: Wire into admin Layout
- **Modify**: `frontend/src/pages/admin/Layout.tsx` — add nav link "API Keys".
- **Modify**: `frontend/src/App.tsx` — route `/admin/api-keys` → `<ApiKeys />`.

---

## Phase 6: Frontend — Public docs page + home nav tab

WRITE_FILE BUDGET: 5 new files, 2 modified.

### Task 6.1: Docs page shell
- **Create**: `frontend/src/pages/ApiDocs.tsx` — full page using `<PaperTexture />` + washi color tokens. Top: hero with title "drop API" + subtitle "为你和 Yui 准备的小巧上传接口 ✨". Below: TOC sticky on left, content on right.
- Sections (each a separate component in next tasks for modularity):
  - 🔑 鉴权 (auth)
  - 📤 上传文件 (POST /upload)
  - 📋 列出分享 (GET /shares)
  - 🔍 查询分享 (GET /shares/{code})
  - ⏰ 过期时间说明 (expire_style enum table — all 7 values)
  - ⚠️ 错误码 (error code table)
  - 📊 配额限制 (quota explanation)
  - 📮 申请 key (contact section — "需要 API key 请联系 leo@leod.me 或 Discord @leeeo.d")

### Task 6.2: Endpoint detail component
- **Create**: `frontend/src/pages/api-docs/EndpointBlock.tsx` — reusable component for one endpoint section. Props: method, path, description, params (table), responseShape (JSON code block), curlExample (with copy button).

### Task 6.3: Code block + copy button
- **Create**: `frontend/src/pages/api-docs/CodeBlock.tsx` — monospace block with copy-to-clipboard, washi-styled (subtle paper background, light border).

### Task 6.4: Enum/error tables
- **Create**: `frontend/src/pages/api-docs/ExpireStyleTable.tsx` — table of 7 expire_style values with example + meaning.
- **Create**: `frontend/src/pages/api-docs/ErrorCodeTable.tsx` — table of error codes (4011/4012/4013/4031/4291/4292/4293).

### Task 6.5: Home nav tab + routing
- **Modify**: `frontend/src/variants/washi/Header.tsx` (or `Tabs.tsx` — confirm which holds top nav by reading file) — add "API" link → `/api/docs`. Style consistent with existing nav.
- **Modify**: `frontend/src/App.tsx` — route `/api/docs` → `<ApiDocs />`. Make sure SPA fallback in `main.py` doesn't intercept (it explicitly excludes `api/` paths — verify in Phase 7 deploy).

---

## Phase 7: Build + deploy + verify

### Task 7.1: Local full build
- `cd backend && uv run pytest -q` (or `pytest`) — all green.
- `cd frontend && pnpm build` — no TS errors, no ESLint failures.
- `cd backend && alembic upgrade head` against a scratch DB — clean.

### Task 7.2: Commit + PR
- Branch `feat/api-v1-with-admin-keys`, conventional commit messages, push, open PR with English description (public repo, see `github-pr-workflow` skill `references/public-repo-tone.md`).
- Self-review the PR diff before merging.

### Task 7.3: Deploy to Tokyo VPS (per `yui-drop-deploy` skill)
- `ssh -i ~/.ssh/tokyo-vps admin@52.68.33.186`
- `cd /opt/yui-drop/repo && sudo git pull --ff-only origin main`
- `sudo docker compose up -d --build` (background=true via terminal tool)
- Wait 20s, verify `(healthy)` + `curl /api/health` returns ok.

### Task 7.4: Production smoke test
- Admin login → issue test key with note `"smoke-test-2026-05-27"`.
- `curl -X POST https://drop.leod.me/api/v1/upload -H "Authorization: Bearer yd_..." -F 'file=@/tmp/test.txt' -F 'expire_value=1' -F 'expire_style=day'`
- Verify response shape, follow returned `url`, file downloads.
- `curl https://drop.leod.me/api/v1/shares -H "Authorization: Bearer yd_..."` — entry present.
- Revoke key, retry upload, expect 401.
- Visit https://drop.leod.me/api/docs — page renders, washi style, all sections present.
- Click "API" nav tab from home — navigates correctly.

### Task 7.5: Spec self-check (mandatory per memory rule)
After deployment, controller produces a checklist verifying every requirement from 主人's original requests:
- ✅ Admin can issue multiple keys with notes
- ✅ Admin can override quota per key
- ✅ Plaintext key shown once, never again
- ✅ Public docs page exists at /api/docs in washi style
- ✅ Home page has nav tab linking to /api/docs
- ✅ Docs page mentions "contact leo to request key"
- ✅ Quota + rate limit + scope all enforced
- ✅ No public self-signup
Report back to 主人 with this checklist + key URLs.

---

## File-write budget per dispatch (master tally)

| Phase | Subagent dispatch | New files | Modified files | Total writes |
|---|---|---|---|---|
| 1 | DB models + migration | 3 | 2 | 5 |
| 2 | Auth + v1 routes | 4 | 1 | 5 |
| 3 | Admin key endpoints | 2 | 1 | 3 |
| 4 | Backend tests + smoke | 2 | 0 | 2 |
| 5 | Admin ApiKeys UI | 4 | 2 | 6 |
| 6 | Public docs page + nav | 5 | 2 | 7 |
| 7 | Deploy + verify (controller, not subagent) | 0 | 0 | 0 |

All phases ≤ 12 writes → well under the 20-write subagent cap. Each phase is dispatched as ONE subagent + spec review + quality review.

---

## Risks + mitigation

| Risk | Mitigation |
|---|---|
| Swagger UI move breaks dev tooling | Keep at `/api/_swagger` (still accessible) |
| Rate limiter clash with existing IP-based limiter | Use distinct key (key_id-based) so they coexist |
| `extra="forbid"` schema causes 422 (known pattern from PR #18) | New schemas explicitly include only documented fields; tests cover the wire format |
| argon2 not in deps | Check `pyproject.toml`; add `argon2-cffi` if missing as part of Task 2.1 |
| Plaintext key leaks via logs | `core/logging.py` already redacts `Authorization` header — verify in Task 2.1 |
| Daily quota race condition under concurrent uploads | Use `ON CONFLICT DO UPDATE` atomic upsert in SQLite for `api_key_usage` |

---

**Plan complete. Ready to execute using subagent-driven-development.**
