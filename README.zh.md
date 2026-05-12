<div align="center">

# Yui-Drop

### 6 位数字取件码的可自部署文件快递柜

[English](./README.md) · 中文 (默认) · [日本語](./README.ja.md)

[在线 Demo](https://drop.leod.me) · [快速开始](#快速开始)

</div>

---

## 关于

Yui-Drop 是一个现代的、可自部署的「文件快递柜」：丢入文件（或粘贴文字片段），得到 6 位数字取件码，把码告诉别人即可。无需注册账号、无需链接、无需邮件 —— 只是一个可以电话口述的数字。

灵感来自 [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) 的全新独立重写，聚焦于 Linear 风格 UI、移动端优先布局、现代化的 Python/JS 技术栈（FastAPI + React 18）、更严格的默认安全配置，以及 Cloudflare R2 / S3 多分块浏览器直传 —— API 服务器永远不接触大文件。

Yui-Drop is a modern, self-hostable "file-codebox": drop a file (or paste a text snippet), get a short 6-digit pickup code, share the code, done. No accounts, no links, no email — just a number you can read out over the phone.

A fresh rewrite inspired by [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox), built around a Linear-style UI, mobile-first layout, modern Python/JS stacks (FastAPI + React 18), tighter security defaults, and Cloudflare R2 / S3 multipart direct-upload so the API server never touches large files.

---

<div align="center">

🔒 **默认安全** — 全链路 HTTPS (TLS 1.3)，存储侧 AES-256（R2 SSE），严格 CSP，速率限制
✨ **现代化技术栈** — React 18、FastAPI、SQLAlchemy 2.0、S3 多分块浏览器直传
📦 **自部署** — 单条 `docker compose up` 一键起服

🔒 **Secure by design** — TLS 1.3, AES-256 at-rest (R2 SSE), strict CSP, rate-limited
✨ **Modern stack** — React 18, FastAPI, SQLAlchemy 2.0, S3 multipart direct upload
📦 **Self-hosted** — single `docker compose up` deploys the whole stack

</div>

---

## 功能特性

- 🔑 **6 位数字取件码** — 短、好记、可口述
- 📁 **文件与文字** — 最大 10 GB 文件，或粘贴文字片段
- 👁️ **浏览器内嵌预览** — 图片、PDF、视频、音频、文本、Markdown 直接在网页里看，不强制下载
- 🪣 **可插拔存储** — 本地、S3/Cloudflare R2（支持分块直传）、OneDrive、WebDAV
- ⚡ **分块直传对象存储** — 大文件从浏览器直接传到 bucket，支持断点续传、并发分块、自动重试
- 🎨 **5 种主题色** + 亮 / 暗 / 跟随系统三种显示模式，本地持久化
- 🌐 **三语 UI** — English / 简体中文 / 日本語，自动识别、可手动切换
- 🛡️ **安全第一** — 详见下方 [安全](#安全)
- 🗑️ **软删除 + 后台回收站** — 过期或管理员删除的分享会先进回收站，可恢复或手动硬删

## 架构

```
┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
│   React SPA  │◄────►│   FastAPI    │◄────►│   SQLite / DB    │
│  Vite + TS   │      │  Python 3.12 │      │   (仅存元数据)   │
└──────┬───────┘      └──────┬───────┘      └──────────────────┘
       │                     │
       │ multipart 直传      │ presign / complete
       └─────────────┐ ┌─────┘
                     ▼ ▼
              ┌──────────────────┐
              │     对象存储     │
              │  R2 / S3 / 本地  │
              └──────────────────┘
```

- **前端** — React 18、Vite、TypeScript、Tailwind、react-i18next、TanStack Query、Zustand、lucide-react
- **后端** — FastAPI、SQLAlchemy 2.0（async）、Alembic 迁移、Pydantic v2、structlog、slowapi
- **存储抽象** — 单一 `StorageBackend` 接口，通过 `.env` 切换后端
- 使用 S3/R2 时**文件不经过 API 服务器** — 浏览器通过 presigned multipart URL 直传 bucket

## 快速开始

### 一行命令安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/kurobaryo/yui-drop/main/scripts/install.sh | bash
```

安装脚本会：
1. 把仓库 clone 到 `./yui-drop`
2. 生成随机的强 `ADMIN_TOKEN` 和 `JWT_SECRET`
3. 写一份初始 `.env`（之后你可以编辑它配置对象存储）
4. 运行 `docker compose up -d --build`
5. 打印管理员 URL 和 token

然后打开 <http://localhost:8000>。默认用本地文件系统存储 —— 直接就能跑，先试用再决定要不要配 R2。

### 手动安装

```bash
git clone https://github.com/kurobaryo/yui-drop.git
cd yui-drop
cp .env.example .env
# 编辑 .env —— 至少设置 ADMIN_TOKEN、JWT_SECRET，以及（可选）S3 / R2 凭据
docker compose up -d --build
open http://localhost:8000
```

### 本地开发（不用 Docker）

```bash
# 后端
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 前端（另开终端）
cd frontend
pnpm install
pnpm dev   # → http://localhost:5173, /api 代理到 :8000
```

## 配置

所有配置都通过环境变量（`.env`）。完整列表见 [`.env.example`](./.env.example)。关键变量：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `ADMIN_TOKEN` | *随机* | 引导期的管理员密码（首次启动后会被 hash 化） |
| `JWT_SECRET`  | *随机* | 服务端 JWT 签名密钥 |
| `STORAGE_BACKEND` | `local` | `local`、`s3`、`onedrive`、`webdav` |
| `S3_ENDPOINT_URL` | *(空)* | 例如 `https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET_NAME`  | *(空)* | 存放上传文件的 bucket |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | *(空)* | R2 / S3 凭据 |
| `RATE_LIMIT_UPLOAD_PER_MIN` | `5` | 单 IP 每分钟上传次数上限 |
| `RATE_LIMIT_RETRIEVE_FAILS_PER_HOUR` | `20` | 单 IP 每小时取件失败上限（超过自动封禁）|
| `MAX_UPLOAD_BYTES` | `10737418240` | 单文件大小上限（默认 10 GiB）|
| `STORAGE_QUOTA_BYTES` | *(无限)* | 全局存储总配额 |
| `EXPIRE_SWEEPER_INTERVAL_MIN` | `10` | 软删除清理任务运行间隔 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | *(空)* | 可选的 Cloudflare Turnstile 反爬虫 |
| `ALLOWED_ORIGINS` | *(部署域名)* | CORS 白名单；生产环境**绝不**设为 `*` |

管理员可在运行时修改的设置（存储凭据、速率限制、UI 文案等）保存在数据库里，可从 `/admin/settings` 编辑。敏感密钥（`ADMIN_TOKEN`、`JWT_SECRET`）只保留在 `.env`，不会被写回数据库。

## 安全

UI 上的「🔒 安全加密 · 匿名」徽章背后的实际能力：

### 哪些是加密的

- **传输** —— 客户端 ↔ 服务器全程 HTTPS（TLS 1.3，建议部署在 Caddy / Nginx Proxy Manager + Let's Encrypt 后面）
- **存储** —— Cloudflare R2 和 AWS S3 默认对每个对象用 AES-256 服务端加密（SSE），覆盖「硬盘被偷 / 物理介质被扣押」威胁模型
- **管理员密码** —— 加盐 hash 存储；原始 token 仅在 `.env`
- **JWT** —— HS256 / RS256 签名；secret 在 `.env`

> Yui-Drop **不做端到端加密**。我们的目标是日常文件的快速分享 —— 一个可以口述的取件码。如果你需要零知识保证（服务器无法读取文件），用 [Send](https://send.vis.ee) 或 [Wormhole](https://wormhole.app) 这类工具。

### 防御了哪些威胁

| 威胁 | 防御 |
|---|---|
| SQL 注入 | SQLAlchemy 2.0 参数化查询，不拼字符串 |
| XSS（上传的 HTML / SVG） | SVG 强制下载（不内嵌预览），HTML 文件强制下载，文本/Markdown 用 `text/plain` 返回并经过 DOMPurify |
| CSRF | 纯 Bearer JWT，无 cookie 会话，无环境凭据 |
| 暴力枚举取件码 | 单 IP 失败 20 次 → 软封 1 小时；生成的取件码避开低熵序列（`123456`、`111111` 等）|
| 存储被刷爆 | 单 IP 限速 5/分、30/时、200/天；全局存储配额（后台可配）；1 小时清理孤儿 multipart |
| Multipart 大小造假 | `complete` 阶段 HEAD 真实对象，与声明大小偏差 >5% 直接拒收 |
| 管理员爆破 | 单 IP 5 分钟 ≤10 次登录尝试 + 指数退避 |
| 点击劫持 / 嵌入 | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` |
| MIME 嗅探 | `X-Content-Type-Options: nosniff` |
| `Content-Disposition` 头注入 | 文件名清洗 + RFC 5987 编码 |
| 开放重定向 | 所有路由都不接收用户提供的跳转目标 |
| 路径穿越 | 文件名清洗（`..` / 控制字符 / Windows 保留名）；存储路径基于服务端 UUID，不信任用户输入 |

可选的 Cloudflare Turnstile 反爬虫已经接入但**默认关闭** —— 在 `.env` 填好 site key 和 secret 后从后台开关。

### 日志与保留

- **访问日志记录客户端 IP 和 User-Agent** 用于滥用追溯，管理员可在 `/admin/logs` 查询
- **软删除** —— 过期或被管理员删除的分享只是打上 `deleted_at` 标记，bucket 中的对象仍保留。管理员可以从回收站恢复或硬删（同时删除 bucket 对象）
- **自动清理任务** 每 `EXPIRE_SWEEPER_INTERVAL_MIN` 分钟运行一次，将过期记录软删，同时 abort 超时的 multipart session

## 仓库结构

```
yui-drop/
├── README.md              ← English (默认)
├── README.zh.md           ← 本文件，中文
├── README.ja.md           ← 日本語
├── LICENSE                ← MIT
├── docker-compose.yml     ← 一键部署
├── .env.example           ← 所有可配置环境变量（带注释）
├── scripts/
│   ├── install.sh         ← 一行命令安装脚本
│   └── ...                ← 运维辅助
├── backend/               ← Python · FastAPI · SQLAlchemy 2.0
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── alembic.ini · alembic/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/           ← 路由模块
│   │   ├── core/          ← 配置、安全、依赖
│   │   ├── db/            ← session、base
│   │   ├── models/        ← SQLAlchemy 模型
│   │   ├── schemas/       ← Pydantic v2 DTO
│   │   ├── services/      ← 业务逻辑
│   │   └── storage/       ← 各存储后端实现
│   └── tests/
├── frontend/              ← React 18 · Vite · TypeScript
│   ├── package.json
│   ├── Dockerfile
│   ├── vite.config.ts · tailwind.config.ts · tsconfig.json
│   ├── public/
│   └── src/
│       ├── main.tsx · App.tsx
│       ├── routes/                ← 路由组件
│       ├── components/ui/         ← Linear 风格原子组件
│       ├── components/motion/     ← 动效组件
│       ├── pages/                 ← 页面级组件
│       ├── hooks/ · api/ · stores/
│       ├── i18n/locales/{en,zh-CN,ja}.json
│       └── styles/
└── docs/
    ├── ARCHITECTURE.md
    ├── API.md             ← REST 契约 + OpenAPI 链接
    └── DEPLOYMENT.md
```

## API

后端在 `GET /api/openapi.json` 提供 OpenAPI 规范，在 `GET /api/docs` 提供交互式 Swagger UI。详细契约见 [`docs/API.md`](./docs/API.md)。

## Roadmap

- [ ] 可选的客户端加密开关（`?c=…&k=…` 形式）
- [ ] 自定义取件码长度（5–8 位）
- [ ] WebPush / 邮件过期通知
- [ ] 文件夹上传（自动 zip）
- [ ] 单分享密码保护
- [ ] ClamAV 病毒扫描钩子

## 致谢

灵感来自 [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) —— 最早的「按码分享」匿名文件分享服务。Yui-Drop 是独立重写版本，专注于 Linear 风格 UI、移动优先体验、现代化的 Python/JS 技术栈和更严格的默认安全配置，未共享任何源代码。

## License

MIT —— 见 [LICENSE](./LICENSE)。
