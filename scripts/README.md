# yuidrop — Yui-Drop 运维 CLI

中文 (默认) · [English](./README.en.md) · [日本語](./README.ja.md)

本目录提供管理 Docker Compose 部署的 Yui-Drop 实例所需的 `yuidrop` 运维 CLI，以及一个轻量级安装脚本。

| 文件 | 用途 |
| --- | --- |
| `yuidrop.sh` | CLI 主分发脚本（安装为 `/usr/local/bin/yuidrop`）。 |
| `install-yuidrop.sh` | 一次性安装器 —— 将 CLI 软链入 `/usr/local/bin`，并写入 `/etc/yuidrop.conf`。 |
| `yui-drop-upload.sh` / `yui-drop-upload.py` | 客户端上传辅助脚本（与运维无关）。 |

## 安装

在生产主机上从 Yui-Drop 仓库的全新 checkout 中运行：

```bash
sudo ./scripts/install-yuidrop.sh
```

安装器会：

1. **以软链接的方式**（`ln -sf`）把 `scripts/yuidrop.sh` 链到 `/usr/local/bin/yuidrop`，并对源文件 `chmod +x`。因为是软链接而不是拷贝，每次执行 `yuidrop update` 跑完 `git pull` 之后，`PATH` 上的 CLI 也会自动同步刷新 —— 升级后无需再次运行安装器。
2. 把 `YUIDROP_REPO=<仓库绝对路径>` 写入 `/etc/yuidrop.conf`。
3. 对缺失的依赖给出警告（仅警告，不会让安装失败）。

安装完成后验证：

```bash
yuidrop --version
yuidrop status
```

## 依赖要求

- **Docker Engine** 以及 `docker compose` v2 插件（推荐）。会自动回退到旧版 `docker-compose` v1。
- **git**、**curl**、**bash 4+**。
- **sudo** 权限。所有 `docker` 调用都加 `sudo` 前缀，因为生产 VPS 上的部署用户不在 `docker` 组里。建议为部署账号配置 `sudo NOPASSWD`，否则 `yuidrop update` 会多次提示输入密码。

## 配置

CLI 解析仓库路径的顺序：

1. 环境变量 `$YUIDROP_REPO`（若已设置）。
2. **`/etc/yuidrop.conf`** 中的 `YUIDROP_REPO=…` 行。
3. 默认值：`/opt/yui-drop/repo`。

`/etc/yuidrop.conf` 示例：

```ini
YUIDROP_REPO=/opt/yui-drop/repo
```

容器名硬编码为 `yui-drop`（与 Compose service 一致）。健康检查端点是 `/api/health`；CLI 会通过 `docker port <container> 8000` **自动发现 host 侧映射端口**，所以即使你把容器的 8000 映射到非默认主机端口（例如 nginx-proxy-manager 后端的 `18823`），健康检查也照常工作。如果想从反向代理上探测，可用 `YUIDROP_HEALTH_URL=https://…/api/health` 覆盖。

## 命令

```text
yuidrop update [--force|-f]  fast-forward 拉取 origin/main、重建镜像、跑 alembic
                             迁移、调健康检查。工作区脏的话直接拒绝执行。
                             --force / -f 即使 git 已经是最新版也强制重建 ——
                             适用于运行中的容器已经过期的场景（例如之前手动
                             pull 过、或上次重建被中断）。

yuidrop status               显示：HEAD、分支、容器状态、/api/health JSON、
                             容器内存 + CPU、仓库目录磁盘占用、docker volume
                             清单。

yuidrop logs [-f]            打印容器日志最后 200 行。
                             -f / --follow 切换为持续 tail。

yuidrop restart              对 yui-drop service 执行 docker compose restart。
                             不重建、不迁移。

yuidrop rollback             git reset --hard HEAD~1、重建镜像、跑 alembic
                             迁移、调健康检查。
                             （注意：不会自动执行 down-migration —— 如果被
                             回滚的 commit 引入了不可逆的 schema 变更，可能
                             需要从备份恢复。）

yuidrop --help, -h           显示用法。
yuidrop --version, -v        脚本版本号 + 仓库 HEAD SHA + 容器镜像 SHA。
```

### 用例

```bash
# 标准生产部署
yuidrop update

# git 已是最新但要强制重建（例如上次构建中途失败）
yuidrop update --force

# 修改启动期生效的配置后快速重启服务
yuidrop restart

# 调试时持续 tail 日志
yuidrop logs -f

# 紧急情况：回滚到上一个 commit 并重建
yuidrop rollback
```

## 卸载

```bash
sudo rm /usr/local/bin/yuidrop /etc/yuidrop.conf
```

仓库 checkout 本身以及 Docker 容器 / volume 不会被动到。

## 故障排查

### `docker not found, install Docker first`
`PATH` 上找不到 `docker` 可执行文件。安装 Docker Engine 以及 Compose v2（参见 <https://docs.docker.com/engine/install/>）。

### `Repo path not found: /opt/yui-drop/repo`
原因是 `/etc/yuidrop.conf` 缺失、`$YUIDROP_REPO` 未设置，或者配置中的路径不存在。在真实的仓库 checkout 中重新跑一次 `sudo ./scripts/install-yuidrop.sh` 即可。

### `Working tree has local changes — refusing to update.`
`yuidrop update` 和 `rollback` 拒绝在脏工作区上运行：fast-forward 拉取会失败，`reset --hard` 会默默丢掉未提交的改动。在生产主机上通常意味着 root 直接修改了 tracked 文件（例如 `docker-compose.override.yml`）。先 commit、stash 或 `git checkout --` 这些改动再重试。

### `update` 之后健康检查失败
检查容器日志：`yuidrop logs`。常见原因：
- Alembic 迁移失败 → 找 `alembic.runtime.migration` 报错。
- 新增的环境变量没在 `.env` 或 compose override 里设置。
- 端口 8000（或你的 host 映射端口）被其他进程占用。

如果新构建确实坏了，用 `yuidrop rollback` 回到上个 commit 并重建。

### `sudo: a password is required`
要么交互式运行 `yuidrop`（这样能在终端输入密码），要么为部署用户配置 `sudo NOPASSWD`（推荐，便于无人值守部署）。

### `Neither 'docker compose' (v2) nor 'docker-compose' (v1) is available`
缺少 Compose 插件。Debian / Ubuntu：

```bash
sudo apt-get install docker-compose-plugin
```

## 内部实现 / hacking

`yuidrop.sh` 是单文件自包含的 Bash 脚本，开头使用 `set -euo pipefail`。各部分以 `# ---------- header ----------` 形式的横幅分隔。带颜色的辅助函数 `_info`、`_ok`、`_warn`、`_err` 会在 stdout 不是 TTY 时自动关闭颜色（避免污染日志采集）。

Compose 命令的选择逻辑在 `detect_compose()` 中：优先 `sudo docker compose`，回退到 `sudo docker-compose`。

健康检查的 URL 由 `resolve_health_url()` 决定，按以下优先级寻找：

1. 显式覆盖的 `$YUIDROP_HEALTH_URL`；
2. `sudo docker port <container> 8000` 的输出（host 端口自动发现，覆盖 nginx-proxy-manager 等场景）；
3. 兜底使用 `http://127.0.0.1:8000/api/health`。

若要做 CI / dry-run，可以把 `YUIDROP_REPO` 指向一个临时 checkout；容器名见脚本顶部的 `CONTAINER_NAME` 变量。
