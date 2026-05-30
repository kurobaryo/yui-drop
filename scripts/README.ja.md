# yuidrop — Yui-Drop 運用 CLI

[中文 (デフォルト)](./README.md) · [English](./README.en.md) · 日本語 (このページ)

このディレクトリには、Docker Compose 上で稼働している Yui-Drop デプロイメントを管理するための運用 CLI `yuidrop` と、小さなインストーラが含まれています。

| ファイル | 用途 |
| --- | --- |
| `yuidrop.sh` | CLI 本体（`/usr/local/bin/yuidrop` としてインストール）。 |
| `install-yuidrop.sh` | 一回限りのインストーラ。CLI を `/usr/local/bin` にシンボリックリンクし、`/etc/yuidrop.conf` を書き出します。 |
| `yui-drop-upload.sh` / `yui-drop-upload.py` | クライアント側のアップロード補助スクリプト（運用とは無関係）。 |

## インストール

本番ホストで Yui-Drop リポジトリの新規 checkout から実行します：

```bash
sudo ./scripts/install-yuidrop.sh
```

インストーラは次のことを行います：

1. `scripts/yuidrop.sh` を `/usr/local/bin/yuidrop` に **シンボリックリンク**（`ln -sf`）し、対象に `chmod +x` を付与します。コピーではなくシンボリックリンクなので、`yuidrop update` で `git pull` が走るたびに、`PATH` 上の CLI も自動的に最新になります。リリースのたびにインストーラを再実行する必要はありません。
2. `YUIDROP_REPO=<リポジトリ絶対パス>` を `/etc/yuidrop.conf` に書き込みます。
3. 依存が足りない場合は警告を出します（失敗ではなく警告のみ）。

インストール後の確認：

```bash
yuidrop --version
yuidrop status
```

## 要件

- **Docker Engine** および `docker compose` v2 プラグイン（推奨）。レガシーな `docker-compose` v1 にも自動でフォールバックします。
- **git**、**curl**、**bash 4+**。
- **sudo** 権限。本番 VPS のデプロイユーザは `docker` グループに属していないため、すべての `docker` 呼び出しに `sudo` を付けています。無人デプロイ向けには `sudo NOPASSWD` の設定を推奨します。さもなくば `yuidrop update` の途中で何度かパスワード入力を求められます。

## 設定

CLI はリポジトリパスを以下の順序で解決します：

1. 環境変数 `$YUIDROP_REPO`（設定されている場合）。
2. **`/etc/yuidrop.conf`** 内の `YUIDROP_REPO=…` の行。
3. デフォルト：`/opt/yui-drop/repo`。

`/etc/yuidrop.conf` の例：

```ini
YUIDROP_REPO=/opt/yui-drop/repo
```

コンテナ名は `yui-drop` にハードコードされています（Compose サービス名と一致）。ヘルスチェックのエンドポイントは `/api/health` です。CLI は `docker port <container> 8000` を使って **ホスト側にマッピングされたポートを自動検出** します。したがって、コンテナの 8000 を非デフォルトのホストポート（たとえば nginx-proxy-manager 配下の `18823`）に公開していても、ヘルスチェックはそのまま動作します。リバースプロキシ越しに探りたい場合は `YUIDROP_HEALTH_URL=https://…/api/health` で上書きできます。

## コマンド

```text
yuidrop update [--force|-f]  origin/main を fast-forward で pull、イメージを再
                             ビルド、alembic マイグレーションを実行、ヘルス
                             チェックを叩く。作業ツリーが汚れていれば実行を
                             拒否する。
                             --force / -f を付けると、git が既に最新であって
                             もコンテナだけは強制的に再ビルドする。手動で
                             pull 済みだったり、前回の再ビルドが途中で止まっ
                             ていた場合に有用。

yuidrop status               HEAD・ブランチ・コンテナ状態・/api/health JSON・
                             コンテナのメモリ + CPU・リポジトリのディスク
                             使用量・docker volume の一覧を表示。

yuidrop logs [-f]            コンテナログの末尾 200 行を表示。
                             -f / --follow で継続表示。

yuidrop restart              yui-drop サービスを docker compose restart で
                             再起動。再ビルドもマイグレーションも行わない。

yuidrop rollback             git reset --hard HEAD~1、イメージ再ビルド、
                             alembic マイグレーション、ヘルスチェック。
                             （注意：down-migration は自動では行われません。
                             巻き戻したコミットが不可逆なスキーマ変更を
                             含む場合は、バックアップからの復旧が必要に
                             なることがあります。）

yuidrop --help, -h           ヘルプ表示。
yuidrop --version, -v        スクリプト版番号 + リポジトリ HEAD SHA + コンテナ
                             イメージ SHA を表示。
```

### 使用例

```bash
# 標準的な本番デプロイ
yuidrop update

# git は最新でも強制的にコンテナを再ビルドする
# （前回のビルドが途中で失敗した、など）
yuidrop update --force

# 起動時に取り込まれる設定を変えた後にサービスを素早く再起動
yuidrop restart

# デバッグ中にログを継続表示
yuidrop logs -f

# 緊急事態：直前のコミットを戻して再ビルド
yuidrop rollback
```

## アンインストール

```bash
sudo rm /usr/local/bin/yuidrop /etc/yuidrop.conf
```

リポジトリの checkout 自体、Docker コンテナや volume には触れません。

## トラブルシューティング

### `docker not found, install Docker first`
`docker` バイナリが `PATH` 上にありません。Docker Engine + Compose v2 をインストールしてください（<https://docs.docker.com/engine/install/>）。

### `Repo path not found: /opt/yui-drop/repo`
`/etc/yuidrop.conf` が無いか、`$YUIDROP_REPO` が未設定か、設定されているパスが実在しないケースです。実際の repo checkout の中で `sudo ./scripts/install-yuidrop.sh` を再実行してください。

### `Working tree has local changes — refusing to update.`
`yuidrop update` および `rollback` は、作業ツリーが汚れているときには動作しません。fast-forward な pull は失敗し、`reset --hard` は未コミットの変更を黙って消してしまうためです。本番ホストでは、root が tracked ファイル（例：`docker-compose.override.yml`）を直接編集していた、というのが典型的な原因です。commit、stash、または `git checkout --` で変更を片付けてから再試行してください。

### `update` の後にヘルスチェックが失敗する
コンテナログを確認します：`yuidrop logs`。よくある原因：
- Alembic マイグレーションの失敗 → `alembic.runtime.migration` のエラーを探す。
- 新しい環境変数が必要なのに `.env` や compose override に未設定。
- ポート 8000（あるいはマッピング先のホストポート）が他のプロセスに使われている。

新ビルドが壊れている場合は `yuidrop rollback` で直前のコミットへ戻して再ビルドします。

### `sudo: a password is required`
`yuidrop` を対話シェルから実行してパスワードを入力するか、デプロイユーザに `sudo NOPASSWD` を設定してください（無人デプロイ向けに推奨）。

### `Neither 'docker compose' (v2) nor 'docker-compose' (v1) is available`
Compose プラグインが見つかりません。Debian / Ubuntu の場合：

```bash
sudo apt-get install docker-compose-plugin
```

## 内部実装 / ハッキング向け

`yuidrop.sh` は単一の自己完結型 Bash スクリプトで、冒頭に `set -euo pipefail` を入れています。セクションは `# ---------- header ----------` のバナーで区切られています。カラー付きヘルパ `_info`、`_ok`、`_warn`、`_err` は、stdout が TTY でないときに自動的に色を消します（ログ取り込みを汚しません）。

Compose コマンドの選択は `detect_compose()` にあります。`sudo docker compose` を優先し、`sudo docker-compose` にフォールバックします。

ヘルスチェック URL は `resolve_health_url()` が以下の優先順位で決定します：

1. 明示指定の `$YUIDROP_HEALTH_URL`（最優先）。
2. `sudo docker port <container> 8000` の出力（ホストポート自動検出。nginx-proxy-manager などのケースをカバー）。
3. フォールバックとして `http://127.0.0.1:8000/api/health`。

CI / dry-run では `YUIDROP_REPO` をスクラッチの checkout に向けてください。コンテナ名はスクリプト先頭の `CONTAINER_NAME` 変数で変更できます。
