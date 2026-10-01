<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/images/cover-dark.png">
  <img alt="Yui Drop：在一台设备上寄出文件和文字，另一台设备凭 6 位取件码取件" src="./docs/images/cover-light.png" width="100%">
</picture>

# Yui Drop

**可自部署的文件与文字分享工具。给对方一个 6 位取件码，而不是一串链接。**

中文 · [English](./README.en.md) · [日本語](./README.ja.md)

[快速开始](#快速开始) · [配置](#配置) · [安全](#安全) · [API](#api) · [在线演示](https://drop.leod.me)

</div>

---

## 简介

Yui Drop 是一个用来把文件和文字交给别人的小型网页应用。放入文件、写一段文字，或两者一起寄出，就会得到一个 6 位取件码。对方在任意设备上输入取件码，就能预览或下载。不需要注册账号、邮箱或链接，取件码短到可以直接念给对方听。

所有分享都会过期，可以按天数，也可以按取件次数。Yui Drop 打包成一个 Docker 容器运行，元数据存在 SQLite 里，文件存放在本地磁盘（静态加密）或任意 S3 兼容存储（例如 Cloudflare R2）。

本项目受 [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) 启发，是独立重写的实现，没有共用任何代码。

## 功能

**寄出**
- 一个输入框完成所有操作：写文字、粘贴截图、拖入文件，或一起寄出。和文件一起寄出的文字会作为附言，显示在文件列表上方。
- 单个文件最大 10 GB，一次最多 200 个文件（都可以配置）。
- 使用 S3 / R2 时，文件从浏览器直接分块上传到存储桶，支持断点续传，大文件不经过 API 服务器。
- 可以按时间过期（1 小时到 1 年），也可以按取件次数过期。

**取件**
- 6 格数字输入，输满自动打开；也可以粘贴取件码，每个分享另有一个直达链接。
- 浏览器内预览图片、视频、音频、PDF、Markdown、CSV/TSV（显示为表格）、JSON、日志和源代码。每个文件都可以在新标签页打开，或用全屏查看器放大查看。
- 可以单独下载某个文件，也可以全部下载。

**收集箱**
- 多人共享的投递房间：知道房间号的人都能加入、上传文件、留言。创建者用独立的管理密码管理房间。

**外观**
- 三套可切换的主题（瓷白、Linear、Apple），每套有多种强调色。站点名称、标题和介绍可以在后台修改。
- 跟随系统自动切换深浅色，也可以手动切换。
- 支持简体中文、English、日本語，按浏览器语言自动选择。
- 移动端优先：手机上使用底部弹出面板和大尺寸点击区域，平台支持时提供触感反馈。系统开启「减弱动态效果」时自动关闭动画。

**管理**
- 后台支持分享搜索、预览、回收站、访问日志和存储设置。
- 登录方式：密码、通行密钥（WebAuthn），或接入自己的 OIDC 身份提供方。
- 由管理员签发 API Key，供脚本和其他应用调用（`/api/v1/*`）。

## 快速开始

### 一行命令安装

```bash
curl -fsSL https://raw.githubusercontent.com/kurobaryo/yui-drop/main/scripts/install.sh | bash
```

安装脚本会把仓库克隆到 `./yui-drop`，生成 `ADMIN_TOKEN`、`JWT_SECRET` 和 `SECRETS_KEY`，写好初始 `.env`，执行 `docker compose up -d --build`，最后打印后台地址。之后打开 <http://localhost:8000> 即可。默认把文件存放在本地磁盘。

### 手动安装

```bash
git clone https://github.com/kurobaryo/yui-drop.git
cd yui-drop
cp .env.example .env
# 设置 ADMIN_TOKEN、JWT_SECRET 和 SECRETS_KEY（文件里有生成方法），
# 需要时再填 S3 / R2 凭据。
docker compose up -d --build
```

容器启动时会自动执行数据库迁移。

### 本地开发

```bash
# 后端（Python 3.12）
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 前端，另开一个终端（Node 22）
cd frontend
pnpm install
pnpm dev        # http://localhost:5173，/api 代理到 :8000
```

测试：`cd backend && pytest`；类型检查与构建：`cd frontend && pnpm exec tsc --noEmit && pnpm build`。

## 配置

所有配置都是 `.env` 里的环境变量，完整列表和注释见 [`.env.example`](./.env.example)。最重要的几项：

| 变量 | 默认值 | 用途 |
|---|---|---|
| `ADMIN_TOKEN` | — | 初始管理密码（以哈希形式保存） |
| `JWT_SECRET` | — | 后台会话签名密钥 |
| `SECRETS_KEY` | — | 32 字节密钥，用于加密本地磁盘上的文件和数据库中的敏感配置。未设置时应用拒绝启动。 |
| `APP_URL` / `ALLOWED_ORIGINS` | `http://localhost:8000` | 对外地址和 CORS 白名单。生产环境不要用 `*`。 |
| `STORAGE_BACKEND` | `local` | `local` 或 `s3`（任意 S3 兼容服务，包括 Cloudflare R2） |
| `S3_ENDPOINT_URL`、`S3_BUCKET_NAME`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` | — | `STORAGE_BACKEND=s3` 时的存储桶凭据 |
| `MAX_FILE_BYTES` | `10737418240` | 单个文件上限（10 GiB） |
| `MAX_FILES_PER_SHARE` | `200` | 每个分享的文件数上限 |
| `STORAGE_QUOTA_BYTES` | 不限 | 所有分享的总存储配额 |
| `RATE_LIMIT_UPLOAD_PER_MIN` / `_PER_HOUR` / `_PER_DAY` | `5` / `30` / `200` | 每个 IP 的上传频率限制 |
| `RATE_LIMIT_RETRIEVE_FAILS_PER_HOUR` | `20` | 每个 IP 允许输错取件码的次数，超过后暂时封禁 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | 可选的 Cloudflare Turnstile 人机验证 |

主题、存储方式、频率限制、登录方式和站点文案也可以在后台随时修改。这些设置保存在数据库里，其中的敏感项会加密保存。`ADMIN_TOKEN`、`JWT_SECRET` 和 `SECRETS_KEY` 只存在于 `.env`。

生产部署拓扑、R2 存储桶 CORS 和反向代理的注意事项见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)。

## 安全

Yui Drop 面向日常的快速分享，**不是**端到端加密：服务器能读取你上传的内容。如果需要零知识分享，请使用专门的工具，例如 [Magic Wormhole](https://github.com/magic-wormhole/magic-wormhole)。

**加密**
- 传输中：全程 HTTPS；通过 HTTPS 访问时会发送 HSTS。
- 静态存储：本地磁盘上的文件使用 AES-256-GCM 加密，每个分享一把独立密钥，由 `SECRETS_KEY` 包裹保护；S3 / R2 中的对象使用服务商的 AES-256 服务端加密。
- 管理密码和 API Key 只保存哈希值。

**安全地提供上传的文件**
- 每个文件的 `Content-Type` 由服务器根据扩展名判断，忽略上传者声明的类型。
- 只有图片、音频、视频、PDF 和纯文本会在页面里直接显示；HTML、SVG、XML、脚本及其他所有类型一律只能下载。
- 每个文件响应都带有 `X-Content-Type-Options: nosniff` 和沙箱化的 `Content-Security-Policy`，即使文件类型被伪装，也无法在本站域名下执行脚本。
- Markdown 渲染时禁用原始 HTML，并经过 DOMPurify 清洗。指向不安全协议的链接只显示为文字；外部图片不会自动加载，打开分享不会向第三方服务器发出请求。

**防滥用**
- 取件码会避开容易猜的组合；同一 IP 输错次数过多会被暂时封禁。
- 按 IP 限制上传频率，可设置全局存储配额，可选 Turnstile 人机验证。
- 分块上传完成时会核对实际文件大小，被放弃的上传会自动清理。
- 后台登录限频，可选通行密钥或 OIDC 登录。
- 全站使用严格的 CSP、`frame-ancestors 'self'`、`Referrer-Policy` 和 `Permissions-Policy`；所有数据库查询参数化；文件名经过清洗，存储路径由服务器生成。

**日志与保留**
- 访问日志记录 IP 和 User-Agent，用于处理滥用。可以在后台关闭 IP 记录。
- 过期的分享先进入回收站，管理员可以恢复或彻底删除。

发现安全问题请通过 [GitHub Security Advisories](https://github.com/kurobaryo/yui-drop/security/advisories/new) 私下报告，不要公开提 issue。

## 架构

```
浏览器（React 单页应用）──► FastAPI ──► SQLite（元数据）
        │                     │
        │   预签名分块上传     │   本地磁盘（加密）
        └────────────────────►└── 或 S3 / R2 存储桶
```

- **前端**：React 18、TypeScript、Vite、Zustand、TanStack Query、react-i18next、markdown-it、DOMPurify
- **后端**：FastAPI、SQLAlchemy 2.0（async）、Alembic、Pydantic v2、cryptography
- **存储**：统一的 `StorageBackend` 接口，提供本地和 S3 兼容两种实现

详见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## API

除了网页本身使用的内部接口，Yui Drop 还在 `/api/v1` 提供一套稳定的 REST API，供脚本和其他应用调用。管理员在后台签发 API Key，可限定 `upload` 和 / 或 `read` 权限，并可为每个 Key 单独设置配额。

- `POST /api/v1/upload`：小文件单次上传
- `POST /api/v1/upload/init` → `sign-part` → `complete`：大文件直传存储桶的分块上传
- `POST /api/v1/share/text`：创建文字分享
- `POST /api/v1/pickup`：用取件码取件
- `GET /api/v1/shares`、`GET /api/v1/shares/{code}`：列出和查看该 Key 创建的分享

```bash
YUI_DROP_API_KEY=yd_... ./scripts/yui-drop-upload.sh ./report.pdf
YUI_DROP_API_KEY=yd_... ./scripts/yui-drop-upload.py ./video.mp4 --expire-value 7 --expire-style day
```

完整说明见 [`docs/API.md`](./docs/API.md)，每个实例的 `/docs` 页面也有。

## 运维

`yuidrop` 命令行工具负责服务器上的更新：

```bash
sudo ./scripts/install-yuidrop.sh   # 只需执行一次
yuidrop update                      # 拉取代码、重建、迁移、健康检查
yuidrop rollback                    # 回退到上一个版本
```

详见 [`scripts/README.md`](./scripts/README.md)。

## 目录结构

```
backend/    FastAPI 应用（api/、services/、models/、storage/）、Alembic 迁移、测试
frontend/   React 应用（v2/ 为当前界面，pages/admin/ 为后台，i18n/ 为翻译）
scripts/    安装脚本、yuidrop 命令行工具、上传客户端
docs/       架构、部署、API 文档和图片
```

## 路线图

- 可选的客户端加密
- 带密码保护的分享
- 可配置的取件码长度
- 文件夹上传
- 病毒扫描接入点

## 许可证

[MIT](./LICENSE)
