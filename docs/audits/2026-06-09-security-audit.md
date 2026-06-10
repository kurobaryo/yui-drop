# Yui-Drop / drop.leod.me 代码安全审计报告

> 审计日期：2026-06-09  
> 审计对象：`kurobaryo/yui-drop` public repository  
> 审计 commit：`b79a220` (`feat(collection): show full create form inline on home tab (#34)`)  
> 本地审计副本：`/home/ubuntu/workspace/yui-drop-audit`  
> 生产站点只读 smoke：`https://drop.leod.me`

---

## 1. 摘要

本次审计覆盖 Yui-Drop 的后端 FastAPI / SQLite / storage 层、前端 Vite React SPA、Docker/compose 默认部署配置、依赖漏洞与基础安全扫描。

整体基础较好：

- 未发现真实硬编码密钥。
- 未发现明显 SQL 注入、`eval/exec`、shell injection。
- 前端 `typecheck` / `build` / `eslint` 通过。
- 后端 pytest 通过，Alembic 为单 head。
- Python 依赖未发现已知漏洞。
- Markdown 渲染使用 DOMPurify 消毒，未发现直接未消毒 HTML 注入。

但 **Collection（共享空间 / 收集箱）文件上传子系统存在多处真实 bug 与安全风险**。其中多项已通过临时测试 DB 本地复现，并非纯理论风险：

1. **local storage 下 Collection 文件上传 complete 会 500**。
2. **Collection 管理员关闭上传后，成员仍可 `/files/init` 创建上传**。
3. **Collection local part 上传路径未安全约束，存在 path traversal / 任意路径写入风险**。
4. **Collection 上传生命周期未绑定 uploader/member/upload_id，存在越权污染文件 row 风险**。
5. **未完成上传会提前出现在文件列表，并能拿到 download resolver URL**。

由于开源默认 `STORAGE_BACKEND=local`，这些问题对自部署用户影响较大；生产 drop.leod.me 当前使用 R2，部分 local-only bug 对生产影响较小，但 Collection 生命周期/权限问题仍建议优先修复。

---

## 2. 审计范围

### 2.1 后端

重点审计路径：

- `backend/app/main.py`
- `backend/app/core/*`
- `backend/app/api/*`
- `backend/app/services/*`
- `backend/app/storage/*`
- `backend/app/models/*`
- `backend/app/schemas/*`
- `backend/alembic/*`
- `backend/tests/*`

重点关注：

- 鉴权 / 授权边界
- Admin / API key / member token / upload token
- Collection 上传生命周期
- file/R2/local storage 访问
- path traversal
- CORS / security headers / proxy trust
- rate limit / brute force
- SQLite / SQLAlchemy 查询安全
- JWT / secret 配置
- access log / token 泄露

### 2.2 前端

重点审计路径：

- `frontend/src/lib/*`
- `frontend/src/lib/api/*`
- `frontend/src/stores/*`
- `frontend/src/pages/*`
- `frontend/src/variants/washi/*`

重点关注：

- XSS / Markdown / iframe / media preview
- token storage / localStorage / query token
- schema drift：前端 payload vs backend Pydantic schema
- upload strategy 与 backend source of truth
- OIDC callback token handling
- download / preview URL handling

### 2.3 运维 / 依赖

重点审计路径：

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `frontend/package.json`
- `frontend/pnpm-lock.yaml`
- `backend/pyproject.toml`
- `scripts/*`
- README / docs 中公开部署说明

---

## 3. 实际执行的验证命令与结果

### 3.1 后端质量门

```bash
cd /home/ubuntu/workspace/yui-drop-audit/backend
python3 -m venv /tmp/yui-drop-audit-venv
. /tmp/yui-drop-audit-venv/bin/activate
pip install -e '.[dev]'
SECRETS_KEY=<32-byte-base64url> JWT_SECRET=<test-secret> python -m alembic heads
SECRETS_KEY=<32-byte-base64url> JWT_SECRET=<test-secret> python -m pytest -q
ruff check .
mypy app --ignore-missing-imports
```

结果：

| 检查 | 结果 |
|---|---|
| Alembic heads | ✅ `20260530_0400 (head)` 单 head |
| Pytest | ✅ 全部通过，1 个 S3-dependent test skipped |
| Ruff | ❌ 15 个问题，主要为 import ordering / E402 / unused import |
| Mypy | ❌ 33 个类型问题，主要为 Optional datetime / storage protocol / abstract method |

### 3.2 后端安全扫描

```bash
pip-audit --path /tmp/yui-drop-audit-venv/lib/python3.14/site-packages --progress-spinner off
bandit -q -r backend/app -x backend/tests
```

结果：

| 检查 | 结果 |
|---|---|
| pip-audit | ✅ 未发现已知 Python 依赖漏洞 |
| Bandit | ✅ 仅 Low/误报级别项；无 Medium/High |

Bandit 主要报：

- `Bearer` / `****` 字符串被误识别为 hardcoded password。
- 一些 best-effort cleanup 的 `try/except/pass`。

未作为主要漏洞计入。

### 3.3 前端质量门

```bash
cd /home/ubuntu/workspace/yui-drop-audit/frontend
npx --yes pnpm@10.15.0 install --frozen-lockfile
npx --yes pnpm@10.15.0 audit --prod
npx --yes pnpm@10.15.0 run typecheck
npx --yes pnpm@10.15.0 run build
npx --yes pnpm@10.15.0 run lint
```

结果：

| 检查 | 结果 |
|---|---|
| pnpm audit --prod | ❌ 1 个 moderate：React Router open redirect advisory |
| TypeScript typecheck | ✅ 通过 |
| Vite build | ✅ 通过；主 chunk 约 655 KB，Vite 有 chunk size warning |
| ESLint | ✅ 通过 |

### 3.4 Secret scan

使用简易 regex 扫描：private key、AWS key、Cloudflare token、generic secret assignment、JWT-like string。

结果：

- ✅ 未发现真实密钥。
- `.env.example` 仅包含空值/示例值。

### 3.5 生产只读 smoke

```bash
curl -sS -A 'HermesAudit/1.0' https://drop.leod.me/api/health -w '\nHTTP:%{http_code}\n'

curl -sS -A 'HermesAudit/1.0' \
  -X POST https://drop.leod.me/api/share/multi/init \
  -H 'Content-Type: application/json' \
  -d '{"declared_file_count":2,"declared_total_size":100,"expire_value":1,"expire_style":"day","turnstile_token":null}' \
  -w '\nHTTP:%{http_code}\n'
```

结果：

| Probe | 结果 |
|---|---|
| `/api/health` | ✅ 200 `{status:"ok", db:"ok"}` |
| `/api/share/multi/init` | ✅ 200，说明此前 multi-file 422 类问题当前未复现 |

> 注：生产 smoke 只读/低影响；`multi/init` 会产生一个短期测试 share，按 TTL 自动过期。

---

## 4. 发现列表

> 修复状态更新（2026-06-10，分支 `fix/security-audit-2026-06-09`）：除 YD-2026-009 / YD-2026-010 部分项与 YD-2026-013 的 mypy 历史债外，其余条目已在本分支落地修复并由测试覆盖。

| ID | 严重度 | 标题 | 状态 |
|---|---:|---|---|
| YD-2026-001 | P0/P1 | Collection local backend 上传 complete 直接 500 | ✅ 已修（service 状态机 + local merge/encrypt；`test_collection_local_upload_happy_path_completes_and_lists`） |
| YD-2026-002 | P0/P1 | Collection 关闭上传后仍可 `/files/init` | ✅ 已修（init 校验 closed/upload_enabled/size；`test_collection_upload_disabled_blocks_file_init`） |
| YD-2026-003 | P0/P1 | Collection local part 上传 path traversal / 任意路径写入风险 | ✅ 已修（upload_id 服务端生成 + 严格校验 + 安全 tmp 路径；`test_collection_local_upload_rejects_traversal_upload_id`） |
| YD-2026-004 | P1 | Collection 上传 lifecycle 未绑定 member/upload_id，可能越权污染文件 row | ✅ 已修（part/sign/complete 绑定 owner+upload_id；`test_collection_upload_session_bound_to_original_member`、`test_collection_upload_rejects_wrong_upload_id_for_file`） |
| YD-2026-005 | P1 | 未完成 Collection 文件提前出现在列表，并能拿到 download resolver | ✅ 已修（completed_at 状态列 + 列表/下载过滤 pending；`test_collection_pending_file_is_hidden_from_list_and_download`） |
| YD-2026-006 | P2 | `JWT_SECRET` 缺少启动强校验 | ✅ 已修（main 启动 guard：≥32 字符且拒绝弱值；`test_jwt_secret_guard_*`） |
| YD-2026-007 | P2 | Admin login slowapi limiter 注释，Turnstile admin_login flag 未接入 | ✅ 已修（恢复 `@limiter.limit(login_limit())` + 后端验证 `turnstile_token` + 前端登录页接 invisible widget；`test_admin_login_turnstile_gate_when_enabled`） |
| YD-2026-008 | P2 | Docker 默认暴露 + 信任任意 forwarded headers，限流可被伪造 IP 绕过 | ✅ 已修（compose 默认 `127.0.0.1:8000` + uvicorn forwarded-allow-ips 收紧 + `TRUSTED_PROXY_IPS` 白名单；`test_real_client_ip_*`） |
| YD-2026-009 | P2 | 公共 chunk/presign follow-up 只靠 `upload_id` capability | ⏳ 待修（建议引入 upload token；Collection 侧同类问题已修） |
| YD-2026-010 | P2 | 前端 localStorage / query token 暴露面偏大 | 🟡 部分修（OIDC callback 现在先清 URL 再写 store；localStorage 策略与 SSE query token 仍待产品级决策） |
| YD-2026-011 | P2 | PDF/media preview 缺少 sandbox/referrer hardening | ✅ 已修（PDF iframe `referrerPolicy="no-referrer"`；sandbox 因同源 PDF viewer 需插件能力保持可用性折中） |
| YD-2026-012 | P2 | React Router moderate open redirect advisory | ✅ 已修（react-router-dom 6.30.3 → 6.30.4；`pnpm audit --prod` 0 known vulns） |
| YD-2026-013 | P3 | Ruff / mypy 质量债 | 🟡 部分修（ruff 全绿；mypy 33 个历史错误未在本次范围内清零，且本次改动未新增） |
| YD-2026-014 | P3 | Collection create 前端类型含 `turnstile_token`，后端 schema forbid；当前调用未实际传 | ✅ 已修（移除前端类型字段并注释 schema forbid 约束） |

---

## 5. 详细发现

## YD-2026-001 — Collection local backend 上传 complete 直接 500

**严重度：P0/P1**  
**类型：功能阻断 / storage bug / local default deploy impact**

### 证据位置

- `backend/app/services/collections.py:590-596`
- `backend/app/storage/local.py:157-175`

当前 `complete_collection_file()` 在 local backend 分支中：

```py
await storage.server_write_encrypted(
    file_row.storage_key, upload_id, dek
)
```

但 `LocalStorage.server_write_encrypted()` 的签名为：

```py
async def server_write_encrypted(self, key: str, fileobj: IO[bytes], dek: bytes) -> None:
```

内部会执行：

```py
stream_encrypt(fileobj, out, dek)
```

`stream_encrypt()` 进一步调用：

```py
chunk = src.read(_STREAM_CHUNK)
```

这里传入的是 `upload_id: str`，导致运行时：

```text
AttributeError: 'str' object has no attribute 'read'
```

### 本地复现

使用临时 SQLite DB + local storage：

1. `POST /api/collections` 创建 room。
2. `POST /api/collections/{code}/files/init` 返回 200。
3. `POST /api/collections/{code}/files/{file_id}/parts/0` 返回 200。
4. `POST /api/collections/{code}/files/{file_id}/complete` 抛出：

```text
AttributeError: 'str' object has no attribute 'read'
```

### 影响

- 开源默认 `STORAGE_BACKEND=local` 下 Collection 文件上传无法完成。
- 会留下 pending DB row 与 tmp part 文件。
- 用户可能看到“文件已出现”，但下载失败。
- 对生产 R2/S3 路径影响较小，但对自部署默认配置影响大。

### 修复建议

实现 local complete 时，应当：

1. 通过安全 helper 解析 tmp dir：`LocalStorage._tmp_dir(upload_id)` 或公开 wrapper。
2. 按 part number 顺序读取 `part_N`。
3. merge 成 file-like stream 或临时 merged file。
4. 传 file object 给 `server_write_encrypted(file_row.storage_key, fileobj, dek)`。
5. 成功后设置 `completed_at`。
6. 删除 tmp dir。

### 建议测试

新增测试：

- local collection upload init → part → complete → list → download blob。
- complete 前 download/list 不应暴露。
- 缺 part complete 应返回 400，不应 500。

---

## YD-2026-002 — Collection 关闭上传后仍可 `/files/init`

**严重度：P0/P1**  
**类型：授权逻辑漏洞 / admin policy bypass**

### 证据位置

- `backend/app/services/collections.py:490-546`
- `backend/app/api/collections.py:534-556`

`admin_toggle_upload()` 会设置：

```py
collection.upload_enabled = bool(enabled)
```

但 `init_collection_file()` 未检查 `collection.upload_enabled`。

### 本地复现

临时 DB 中：

1. 创建 Collection。
2. 将 `collection.upload_enabled = False`。
3. 调用：

```http
POST /api/collections/{code}/files/init
X-Member-Token: <member token>
```

结果仍为 200：

```json
{
  "code": 2000,
  "message": "ok",
  "detail": {
    "upload_id": "...",
    "backend": "local",
    "total_chunks": 1,
    "presigned_part_size": null,
    "file_id": 1
  }
}
```

### 影响

管理员关闭 room 上传后，持有 member token 的成员仍能创建新文件上传。

### 修复建议

在 `init_collection_file()` 或 route 入口加：

```py
if _is_closed(collection):
    raise CollectionFileError("closed_or_expired", 410)

if not collection.upload_enabled:
    raise CollectionFileError("upload_disabled", 403)
```

如果产品允许已开始的上传继续 complete，应明确：

- 禁止新 init。
- 对已 init 的 session 是否允许 complete，由 `created_at` 或 session state 决定。

### 建议测试

- `upload_enabled=False` 时 `/files/init` 返回 403。
- `upload_enabled=True` 时正常。
- `closed_at != None` 或 expired room 时拒绝 init/part/complete。

---

## YD-2026-003 — Collection local part 上传 path traversal / 任意路径写入风险

**严重度：P0/P1**  
**类型：path traversal / arbitrary file write within container permissions**

### 证据位置

`backend/app/api/collections.py:589-629`

关键代码：

```py
tmp_root = getattr(storage, "tmp_root", None)
...
tmp_dir = tmp_root / upload_id
tmp_dir.mkdir(parents=True, exist_ok=True)
part_path = tmp_dir / f"part_{part_number}"
with open(part_path, "wb") as out_fp:
    shutil.copyfileobj(chunk.file, out_fp)
```

`upload_id` 来自用户提交的 multipart form：

```py
upload_id: Annotated[str, Form(...)]
```

没有做：

- UUID/hex 格式校验。
- `resolve()` 后检查仍在 `tmp_root` 下。
- 使用 `LocalStorage._tmp_dir()` 现有安全 helper。
- 校验 `upload_id` 是否属于当前 `file_id`。
- 校验 `part_number` 范围。
- 限制单 part 实际大小。

### 影响

持有 Collection member token 的用户可构造恶意 `upload_id`，让服务端将上传内容写入非预期路径下的 `part_N` 文件。

容器权限会限制破坏范围，但仍可造成：

- tmp/root 外任意可写路径文件污染。
- 覆盖应用数据目录中的临时/业务文件。
- DoS / 磁盘污染。

### 修复建议

- 把 `LocalStorage._tmp_dir(upload_id)` 抽成公开安全方法，或在 route 里复制同样逻辑：

```py
d = (tmp_root / upload_id).resolve()
if not str(d).startswith(str(tmp_root.resolve())):
    raise HTTPException(400, ...)
```

更推荐先校验格式：

```py
if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
    raise HTTPException(400, ...)
```

- part number：

```py
if part_number < 0 or part_number >= file_row.expected_parts_total:
    raise HTTPException(400, ...)
```

- 上传体边读边计数，超过 expected part size 立即拒绝。

---

## YD-2026-004 — Collection 上传 lifecycle 未绑定 member/upload_id，可能越权污染文件 row

**严重度：P1**  
**类型：authorization / object ownership mismatch**

### 证据位置

- `backend/app/api/collections.py:559-663`
- `backend/app/services/collections.py:549-618`
- `backend/app/models/collection_file.py`

问题点：

- `files_sign_part()` 解析了 `collection, member`，但没用 `member` 校验 uploader。
- `files_upload_part_local()` 只 `_get_file_or_404()`，不检查 `file_row.member_id == member.id`。
- `files_complete()` 只传 `collection, file_row, upload_id, parts`，service 层没有 `member` 参数。
- `CollectionFile` 模型没有保存 `upload_id`，无法确认 complete 用的是 init 时分配给该 file row 的 upload session。

### 攻击场景

在 public Collection 中，成员可以看到文件列表里的 `file_id`。恶意成员可能：

1. 自己 init 一个 upload，获得自己的 `upload_id`。
2. 对别人的 `file_id` 调用 complete / sign-part / local part。
3. 将别人的 `storage_key` 写成自己的内容或造成损坏。

具体利用细节依赖当前 storage backend，但授权边界本身缺失。

### 修复建议

迁移增加字段：

```py
collection_files.upload_id
collection_files.completed_at
collection_files.expected_parts_total
collection_files.expected_size
```

每个 lifecycle endpoint 校验：

```py
file_row.collection_id == collection.id
file_row.member_id == member.id
file_row.upload_id == upload_id
file_row.completed_at is None
```

如果要允许 room admin 管理上传，应走单独 admin-password-gated 分支，不要让普通 member 默认可操作所有 file row。

### 建议测试

- 成员 A init 的 file，成员 B part/sign/complete 应 403。
- 成员 B 的 upload_id 不能 complete 成员 A 的 file_id。
- wrong upload_id 返回 404/403，不能 silent success。

---

## YD-2026-005 — 未完成 Collection 文件提前出现在列表，并能拿到 download resolver

**严重度：P1**  
**类型：data consistency / broken object exposure / UX bug**

### 证据位置

- `backend/app/models/collection_file.py` 无 `completed_at/state` 字段。
- `backend/app/services/collections.py:621-647` 列表只过滤 `deleted_at`。
- `backend/app/services/collections.py:699-756` local backend download resolver 不先 `head()` 检查对象存在。

### 本地复现

只调用：

```http
POST /api/collections/{code}/files/init
```

不上传 part、不 complete，然后：

```http
GET /api/collections/{code}/files
```

返回：

```json
{
  "files": [
    {
      "id": 1,
      "member_id": 1,
      "nickname": "Owner",
      "name": "x.txt",
      "size": 3,
      "content_type": "text/plain",
      "created_at": "2026-06-09T18:46:08"
    }
  ]
}
```

继续调用：

```http
GET /api/collections/{code}/files/1/download
```

local backend 仍返回 200 和一个 blob URL：

```json
{
  "download_url": "/api/collections/C21928/files/1/blob?token=...",
  "expires_in": 900
}
```

### 影响

- 失败/半成品上传对其他成员可见。
- UI 显示坏文件。
- 可被滥用制造大量假文件记录。
- 下载可能到 blob 阶段才失败。

### 修复建议

- 添加 `completed_at` 或 `state`。
- init row 默认 pending。
- list/download/SSE 只暴露 completed 文件。
- complete 成功写 storage 后设置 `completed_at=now`。
- sweeper 清理超时 pending rows 和 tmp parts。

---

## YD-2026-006 — `JWT_SECRET` 缺少启动强校验

**严重度：P2**  
**类型：config hardening / runtime failure / weak secret risk**

### 证据位置

- `backend/app/core/config.py:36-38`
- `backend/app/main.py:50-85`
- `backend/app/core/security.py:76,81`

`main.py` 启动时只强制检查 `SECRETS_KEY`，没有检查 `JWT_SECRET`。

### 本地复现

在 `JWT_SECRET` unset 的环境下导入 app：

```text
jwt_secret_len 0
app_imported True
```

说明 app 可以启动。随后调用 `issue_admin_token()` 抛：

```text
jwt.exceptions.InvalidKeyError: HMAC key must not be empty.
```

因此空 secret 当前表现为登录/令牌签发路径 runtime failure；如果配置成非空弱值，则可正常签发但安全性不足。

### 影响

`JWT_SECRET` 用于：

- admin JWT
- share multi upload token
- local/blob download token
- WebAuthn challenge HMAC

弱 secret 会扩大伪造风险。

### 修复建议

启动时强制：

- 非空。
- 长度 >= 32 bytes/chars。
- 拒绝常见弱值：`test`, `secret`, `changeme`, `password`, `dev`, `localhost`。

新增测试：

- 空 `JWT_SECRET` 导入 app 必须失败。
- 短 `JWT_SECRET` 导入 app 必须失败。
- 强 secret 正常。

---

## YD-2026-007 — Admin login slowapi limiter 注释，Turnstile admin_login flag 未接入

**严重度：P2**  
**类型：brute force protection gap**

### 证据位置

`backend/app/api/admin.py:121-158`

当前：

```py
# @limiter.limit(login_limit())
```

只使用进程内 `_login_fail_counts` + `asyncio.sleep()`。

同时 `backend/app/services/admin_turnstile.py` 有：

```py
PROTECT_ADMIN_LOGIN_KEY = "turnstile.protect_admin_login"
```

但 `admin_login()` 未调用 Turnstile gate。

### 影响

- 多进程 / 重启后计数失效。
- 分布式 IP 攻击可绕过。
- `asyncio.sleep()` 会占住 worker，可能形成 DoS 放大。
- 管理员打开 `protect_admin_login` 也不会保护登录。

### 修复建议

- 恢复 slowapi limiter。按 slowapi 要求给 endpoint 增加 `response: Response` 参数。
- 登录请求 body 增加可选 `turnstile_token`。
- 当 `protect_admin_login` 开启时调用 `turnstile_gate(db, token, flag="protect_admin_login", remote_ip=...)`。
- 长期考虑 Redis-backed limiter。

---

## YD-2026-008 — Docker 默认暴露 + 信任任意 forwarded headers，限流可被伪造 IP 绕过

**严重度：P2**  
**类型：deployment hardening / proxy trust**

### 证据位置

`docker-compose.yml`：

```yaml
ports:
  - "8000:8000"
```

`Dockerfile`：

```bash
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
```

`backend/app/core/rate_limit.py:29-65` 直接信：

- `CF-Connecting-IP`
- `X-Forwarded-For`
- `X-Real-IP`

### 影响

如果开源用户按默认 compose 直接将 8000 暴露公网，攻击者可伪造 header：

```http
CF-Connecting-IP: 1.2.3.4
X-Forwarded-For: 5.6.7.8
```

从而：

- 绕过 per-IP upload/login/retrieve 限制。
- 污染 access logs。

生产 drop.leod.me 当前技能记录为 `127.0.0.1:18823` behind NPM，因此生产暴露面较低；但开源默认部署有坑。

### 修复建议

- compose 默认改为：

```yaml
ports:
  - "127.0.0.1:8000:8000"
```

- `--forwarded-allow-ips` 改为明确 proxy IP/CIDR，不要 `*`。
- `real_client_ip()` 仅当 `request.client.host` 属于 trusted proxy 时才信 forwarded headers。
- README 强调 backend 不应裸奔公网。

---

## YD-2026-009 — 公共 chunk/presign follow-up 只靠 `upload_id` capability

**严重度：P2**  
**类型：capability token hardening**

### 证据位置

- `backend/app/api/chunk.py:102-179`
- `backend/app/api/presign.py:105-179`

`init` 后续端点：

- part
- status
- complete
- abort

都只需要 `upload_id`。

### 影响

`upload_id` 是 UUID hex，不可枚举，所以不是 immediate high risk。  
但如果 `upload_id` 通过日志、截图、browser history、异常上报或 Referer 泄漏，第三方可操作该 upload session。

### 修复建议

- `init` 返回短期 `upload_token` JWT。
- JWT claims：`upload_id`, `scope`, `exp`。
- follow-up endpoint 必须带 Bearer token。
- status 也需要 token。
- 前端 transport adapter 闭包保存 token 并传给 part/status/complete/abort。

---

## YD-2026-010 — 前端 localStorage / query token 暴露面偏大

**严重度：P2**  
**类型：browser-side token exposure / design tradeoff**

### 证据位置

- `frontend/src/stores/admin.ts`
- `frontend/src/stores/collectionMember.ts`
- `frontend/src/lib/collectionSse.ts`
- `frontend/src/lib/api/collection.ts`

当前：

- admin Bearer token 存 localStorage。
- Collection member token 存 localStorage。
- Collection admin password 可选存 localStorage。
- SSE 使用 `?token=<member_token>`。
- local download blob 使用 `?token=<jwt>`。

### 影响

代码注释明确这是 usability tradeoff。风险包括：

- XSS 后 token 可被读出。
- 恶意浏览器扩展可读 localStorage。
- query token 可能进入代理日志 / monitoring / browser history。

### 修复建议

- Admin session：优先 HttpOnly + Secure + SameSite cookie；或 sessionStorage/in-memory + 短 TTL。
- Collection admin password：默认不持久化，必须用户明确 “remember this device”。
- 提供 clear room credentials UI。
- SSE 改 fetch streaming/WebSocket header auth；或使用短期 SSE token。
- access log 统一 redact query 参数里的 `token`。

---

## YD-2026-011 — PDF/media preview 缺少 sandbox/referrer hardening

**严重度：P2**  
**类型：frontend hardening**

### 证据位置

`frontend/src/variants/washi/tabs/PickupModal.tsx:373-385`

当前：

```tsx
<iframe
  src={item.url}
  title={name || t('washi.preview_pdf')}
  ...
/>
```

缺少：

- `sandbox`
- `referrerPolicy="no-referrer"`

多文件下载 `<a href={f.url}>` 也缺少 `rel/referrerPolicy`。

### 修复建议

PDF：

```tsx
<iframe
  src={item.url}
  sandbox="allow-same-origin"
  referrerPolicy="no-referrer"
  ...
/>
```

如果 PDF viewer 需要脚本，再评估是否加 `allow-scripts`。  
媒体元素与下载链接也建议添加 `referrerPolicy="no-referrer"`；外链加 `rel="noopener noreferrer"`。

---

## YD-2026-012 — React Router moderate open redirect advisory

**严重度：P2**  
**类型：dependency vulnerability**

### 证据

`pnpm audit --prod` 报：

```text
React Router's same-origin redirect with path starting // causes open redirect
Package: react-router
Vulnerable versions: >=6.7.0 <6.30.4
Patched versions: >=6.30.4
GHSA-2j2x-hqr9-3h42
```

当前解析：

```text
react-router-dom 6.30.3
react-router 6.30.3
```

### 修复建议

```bash
cd frontend
npx pnpm@10.15.0 update react-router-dom react-router
```

或显式 pin 到 `>=6.30.4`。

修复后重跑：

```bash
pnpm audit --prod
pnpm run typecheck
pnpm run build
pnpm run lint
```

---

## YD-2026-013 — Ruff / mypy 质量债

**严重度：P3**  
**类型：maintainability / correctness safety net**

### 证据

`ruff check .`：15 个问题。

主要集中：

- `app/api/collections.py` import ordering。
- `app/services/collections.py` E402 module-level import not at top。
- unused import：`generate_unique_pickup_code`。

`mypy app --ignore-missing-imports`：33 个问题。

主要集中：

- Optional datetime 与 comparison。
- storage protocol / abstract method。
- `OneDriveStorage` / `WebDAVStorage` abstract method `delete_many`。
- Collection route return type / None handling。

### 影响

这些不是直接漏洞，但会降低安全修复时的可靠性。Collection 本次多个问题没有被现有测试/类型系统捕获。

### 修复建议

- 先 `ruff --fix` 修 import/unused。
- 给 storage protocol 补齐 `delete_many`。
- 对 datetime column 使用 `as_utc()` helper 后再比较。
- 将 mypy 纳入 CI，但可先设置 baseline，逐步收敛。

---

## YD-2026-014 — Collection create 前端类型含 `turnstile_token`，后端 schema forbid；当前未实际传

**严重度：P3**  
**类型：schema drift / future bug trap**

### 证据位置

前端：`frontend/src/lib/api/collection.ts:31-42`

```ts
export interface CreateCollectionRequest {
  ...
  turnstile_token?: string | null;
}
```

后端：`backend/app/schemas/collection.py:17-35`

```py
class CreateCollectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ...
```

后端没有 `turnstile_token` 字段。

当前实际 create 调用处没有传 `turnstile_token`：

- `frontend/src/pages/Collection/Create.tsx`
- `frontend/src/variants/washi/tabs/Collection.tsx`

所以当前不是线上必现 bug，但属于同类 schema drift trap：未来一旦 UI 接入 Collection Turnstile，就会 422。

### 修复建议

二选一：

1. 后端 schema 加 `turnstile_token: str | None = None` 并真正 gate create。
2. 前端类型删除 `turnstile_token`，避免误导。

---

## 6. 建议修复顺序

### Phase 1 — Collection 上传安全/正确性 hotfix（最高优先级）

目标：一次性修掉 YD-2026-001 ~ YD-2026-005。

建议变更：

1. Alembic migration：
   - `collection_files.upload_id: str | None`
   - `collection_files.completed_at: datetime | None`
   - `collection_files.expected_parts_total: int | None`
   - `collection_files.expected_size: bigint | None`
2. `init_collection_file()`：
   - 检查 `_is_closed(collection)`。
   - 检查 `collection.upload_enabled`。
   - 检查 `size > 0`。
   - 检查 max file size / room quota。
   - 存储 `upload_id` / expected fields。
3. `files_upload_part_local()`：
   - 校验 file owner。
   - 校验 upload_id 与 file_row 绑定。
   - 校验 part_number 范围。
   - 用 safe tmp helper。
   - 限制实际 chunk size。
4. `files_sign_part()` / `files_complete()`：
   - 同样校验 owner + upload_id 绑定。
5. local complete：
   - merge tmp parts 成 file object。
   - 调用 `server_write_encrypted()`。
   - 成功后 `completed_at=now`。
6. `list_files()` / `get_file_download_url()`：
   - 只返回 completed 文件。
7. sweeper：
   - 清理 expired pending rows/tmp dirs。
8. 测试：
   - local happy path。
   - upload disabled。
   - path traversal 拒绝。
   - cross-member 操作拒绝。
   - pending file 不出现在 list/download。

### Phase 2 — Secret / login / proxy hardening

目标：修 YD-2026-006 ~ YD-2026-008。

- JWT_SECRET startup guard。
- Admin login slowapi limiter。
- Admin login Turnstile gate。
- Docker bind localhost 默认。
- trusted proxy headers。

### Phase 3 — Public upload capability token

目标：修 YD-2026-009。

- `/api/chunk/*` 和 `/api/presign/*` follow-up 接 upload token。
- frontend adapters 保存并发送 token。

### Phase 4 — Frontend exposure / preview hardening

目标：修 YD-2026-010 ~ YD-2026-011。

- localStorage/session strategy。
- SSE query token 替代方案。
- iframe sandbox/referrer policy。

### Phase 5 — Dependency + quality cleanup

目标：修 YD-2026-012 ~ YD-2026-014。

- React Router 升级。
- ruff/mypy 收敛。
- Collection create schema drift 清理。

---

## 7. 推荐新增测试清单

### Collection upload

- `test_collection_upload_disabled_blocks_init`
- `test_collection_local_upload_happy_path_completes_and_downloads`
- `test_collection_pending_file_hidden_from_list`
- `test_collection_pending_file_download_returns_404`
- `test_collection_local_upload_rejects_path_traversal_upload_id`
- `test_collection_local_upload_rejects_invalid_part_number`
- `test_collection_upload_member_cannot_complete_other_members_file`
- `test_collection_upload_wrong_upload_id_rejected`
- `test_collection_upload_size_mismatch_rejected`

### JWT / startup

- `test_app_refuses_empty_jwt_secret`
- `test_app_refuses_short_jwt_secret`
- `test_app_accepts_strong_jwt_secret`

### Admin login

- `test_admin_login_rate_limited`
- `test_admin_login_turnstile_gate_when_enabled`
- `test_admin_login_turnstile_skips_when_disabled_or_unconfigured`

### Proxy trust

- `test_real_client_ip_ignores_forwarded_headers_from_untrusted_peer`
- `test_real_client_ip_accepts_forwarded_headers_from_trusted_proxy`

---

## 8. 结论

本次审计最重要的结论是：**主站基础安全面没有发现明显大洞，但 Collection 上传模块存在多个连锁问题**。这些问题来自同一类根因：Collection 上传协议缺少完整的 server-side session state 与所有权绑定，导致：

- 关闭上传无法生效。
- local 上传无法完成。
- pending 文件过早暴露。
- 上传 part 路径不安全。
- 上传 session 与 file row/member 未绑定。

建议先集中修 Collection 上传，不要零散修一个点。正确做法是把 Collection 文件上传也建成明确状态机：`pending -> uploading -> completed/deleted/expired`，并在 DB 中保存 `upload_id` / owner / expected parts / completed_at，再让所有 endpoint 以这个状态机为唯一真相。

---

## 9. 附：本次没有作为漏洞计入的项目

- `Bandit` 报 `Bearer` / `****` / config key 名称为 hardcoded password：误报。
- `try/except/pass` 多为 best-effort cleanup：可改善日志，但非直接漏洞。
- Collection code `C` + 5 digits：旧记录显示这是产品决策，不在本报告中要求改格式；如果要继续保留短码，应通过 rate limit/Turnstile/preview 限制补强。
- Admin token 存 localStorage：代码注释说明为 self-hosted tradeoff，因此作为 P2 hardening，而非 P0。
