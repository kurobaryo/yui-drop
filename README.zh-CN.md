<div align="center">

# Yui-Drop

**匿名 · 临时 · 6 位数字取件码 — 快速分享文件与文字**

一个现代的、可自部署的「文件快递柜」：丢入文件，得到取件码，把码告诉别人即可。
Linear 风格 UI，移动端友好，三语界面（English / 中文 / 日本語），亮/暗模式。

[在线 Demo](https://drop.leod.me) · [快速开始](#快速开始) · [English](./README.md)

🔒 **默认安全** — 全链路 HTTPS (TLS 1.3)，存储侧 AES-256（R2 SSE），严格 CSP，速率限制
✨ **现代化** — React 18、FastAPI、SQLAlchemy 2.0、S3 multipart 浏览器直传
📦 **自部署** — 单条 `docker compose up` 一键起服

</div>

---

## 功能特性

- 🔑 **6 位数字取件码** — 短、好记、可口述
- 📁 **文件与文字** — 最大 10 GB 文件，或粘贴文字片段
- 👁️ **浏览器内嵌预览** — 图片、PDF、视频、音频、文本、Markdown 直接在网页里看，不强制下载
- 🪣 **可插拔存储** — 本地、S3/Cloudflare R2（支持分块直传）、OneDrive、WebDAV
- ⚡ **分块直传对象存储** — 大文件从浏览器直接传到 bucket，支持断点续传、并发分块、自动重试
- 🎨 **5 种主题色** + 亮 / 暗 / 跟随系统三种显示模式，本地持久化
- 🌐 **三语界面** — English / 简体中文 / 日本語，自动识别、可手动切换
- 🛡️ **安全第一** — 详见 [安全](#安全)
- 🗑️ **软删除 + 后台回收站** — 过期或管理员删除的分享会先进回收站，可恢复或手动硬删

## 架构

```
┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
│   React SPA  │◄────►│   FastAPI    │◄────►│   SQLite / DB    │
│  Vite + TS   │      │  Python 3.12 │      │  (仅存元数据)     │
└──────┬───────┘      └──────┬───────┘      └──────────────────┘
       │                     │
       │ multipart 直传       │ presign / complete
       └─────────────┐ ┌─────┘
                     ▼ ▼
              ┌──────────────────┐
              │   对象存储        │
              │ R2 / S3 / 本地    │
              └──────────────────┘
```

使用 S3/R2 时**文件不经过 API 服务器** — 浏览器通过 presigned multipart URL 直传 bucket。

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

然后打开 <http://localhost:8000>。默认用本地文件系统存储 — 直接就能跑，先试用再决定要不要配 R2。

### 手动安装

```bash
git clone https://github.com/kurobaryo/yui-drop.git
cd yui-drop
cp .env.example .env
# 编辑 .env — 至少设置 ADMIN_TOKEN、JWT_SECRET，以及（可选）S3 / R2 凭据
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

## 安全

UI 上的「🔒 安全加密 · 匿名」徽章背后的实际能力：

### 哪些是加密的

- **传输** — 客户端 ↔ 服务器全程 HTTPS（TLS 1.3，建议部署在 Caddy / Nginx Proxy Manager + Let's Encrypt 后面）
- **存储** — Cloudflare R2 和 AWS S3 默认对每个对象用 AES-256 服务端加密（SSE），覆盖"硬盘被偷 / 物理介质被扣押"威胁模型
- **管理员密码** — 加盐 hash 存储；原始 token 仅在 `.env`
- **JWT** — HS256 / RS256 签名；secret 在 `.env`

> Yui-Drop **不做端到端加密**。我们的目标是日常文件的快速分享 — 一个可以口述的取件码。如果你需要零知识保证（服务器无法读取文件），用 [Send](https://send.vis.ee) 或 [Wormhole](https://wormhole.app) 这类工具。

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
| 路径穿越 | 文件名清洗 (`..` / 控制字符 / Windows 保留名)；存储路径基于服务端 UUID，不信任用户输入 |

可选的 Cloudflare Turnstile 反爬虫已经接入但**默认关闭** — 在 `.env` 填好 site key 和 secret 后从后台开关。

### 日志与保留

- **访问日志记录客户端 IP 和 User-Agent** 用于滥用追溯，管理员可在 `/admin/logs` 查询
- **软删除** — 过期或被管理员删除的分享只是打上 `deleted_at` 标记，bucket 中的对象仍保留。管理员可以从回收站恢复或硬删（同时删除 bucket 对象）
- **自动清理任务** 每 `EXPIRE_SWEEPER_INTERVAL_MIN` 分钟运行一次，将过期记录软删，同时 abort 超时的 multipart session

## License

MIT — 见 [LICENSE](./LICENSE)。

## 致谢

灵感来自 [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) — 最早的「按码分享」匿名文件分享服务。Yui-Drop 是独立重写版本，专注于 Linear 风格 UI、移动优先体验、现代化的 Python/JS 技术栈和更严格的默认安全配置，未共享任何源代码。
