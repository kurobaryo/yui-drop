<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/images/cover-dark.png">
  <img alt="Yui Drop：あるデバイスでファイルやテキストを送り、別のデバイスで 6 桁のコードを使って受け取る" src="./docs/images/cover-light.png" width="100%">
</picture>

# Yui Drop

**セルフホストできるファイル・テキスト共有ツール。リンクではなく 6 桁の受け取りコードを渡します。**

[中文](./README.md) · [English](./README.en.md) · 日本語

[クイックスタート](#クイックスタート) · [設定](#設定) · [セキュリティ](#セキュリティ) · [API](#api) · [デモ](https://drop.leod.me)

</div>

---

## 概要

Yui Drop は、ファイルやテキストを相手に渡すための小さな Web アプリです。ファイルを入れる、テキストを書く、またはその両方を送ると、6 桁の受け取りコードが発行されます。相手はどのデバイスでもそのコードを入力するだけで、プレビューやダウンロードができます。アカウントもメールアドレスもリンクも不要で、コードは口頭で伝えられるほど短くなっています。

共有には必ず期限があり、日数または受け取り回数で指定できます。Yui Drop は Docker コンテナ 1 つで動作し、メタデータは SQLite に、ファイルはローカルディスク（保存時暗号化）または任意の S3 互換ストレージ（Cloudflare R2 など）に保存します。

[vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) に着想を得た独立した実装で、コードは共有していません。

## 機能

**送信**
- 1 つの入力欄ですべて完結します。テキストの入力、スクリーンショットの貼り付け、ファイルのドラッグ、またはその組み合わせで送れます。ファイルと一緒に送ったテキストは、メッセージとしてファイル一覧の上に表示されます。
- 1 ファイル最大 10 GB、1 回の共有で最大 200 ファイル（いずれも設定可能）。
- S3 / R2 を使う場合、ファイルはブラウザからバケットへ直接マルチパートでアップロードされます。再開に対応しており、大きなファイルが API サーバーを経由することはありません。
- 期限は時間（1 時間〜1 年）または受け取り回数で設定できます。

**受け取り**
- 6 マスの数字入力で、最後の桁を入れると自動で開きます。コードの貼り付けにも対応し、共有ごとに直接開けるリンクもあります。
- 画像、動画、音声、PDF、Markdown、CSV/TSV（表として表示）、JSON、ログ、ソースコードをブラウザ内でプレビューできます。各ファイルは新しいタブ、または全画面ビューアーで大きく表示できます。
- ファイルは個別にも、まとめてもダウンロードできます。

**コレクション**
- 複数人で使う投函ルームです。ルームコードを知っている人なら誰でも参加し、ファイルのアップロードやメッセージの投稿ができます。作成者は専用の管理パスワードでルームを管理します。

**外観**
- 3 つのテーマ（Porcelain、Linear、Apple）を切り替えられ、それぞれ複数のアクセントカラーがあります。サイト名、タイトル、紹介文は管理画面から編集できます。
- システムのライト / ダーク設定に追従し、手動でも切り替えられます。
- 日本語、English、简体中文に対応し、ブラウザの言語から自動で選びます。
- モバイルファーストの設計です。スマートフォンではボトムシートと大きなタップ領域を使い、対応環境では触覚フィードバックもあります。「視差効果を減らす」が有効な場合、アニメーションは自動で無効になります。

**管理**
- 共有の検索、プレビュー、ごみ箱、アクセスログ、ストレージ設定を備えた管理画面。
- パスワード、パスキー（WebAuthn）、または独自の OIDC プロバイダーでサインインできます。
- スクリプトや他のアプリ向けに、管理者が API キーを発行できます（`/api/v1/*`）。

## クイックスタート

### ワンライナーでインストール

```bash
curl -fsSL https://raw.githubusercontent.com/kurobaryo/yui-drop/main/scripts/install.sh | bash
```

インストーラーは、リポジトリを `./yui-drop` にクローンし、`ADMIN_TOKEN`、`JWT_SECRET`、`SECRETS_KEY` を生成して初期 `.env` を作成します。その後 `docker compose up -d --build` を実行し、管理画面の URL を表示します。完了したら <http://localhost:8000> を開いてください。デフォルトではファイルをローカルディスクに保存します。

### 手動インストール

```bash
git clone https://github.com/kurobaryo/yui-drop.git
cd yui-drop
cp .env.example .env
# ADMIN_TOKEN、JWT_SECRET、SECRETS_KEY を設定します（生成方法はファイル内に記載）。
# 必要に応じて S3 / R2 の認証情報も設定します。
docker compose up -d --build
```

データベースのマイグレーションはコンテナ起動時に自動で実行されます。

### ローカル開発

```bash
# バックエンド（Python 3.12）
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# フロントエンド（別ターミナル、Node 22）
cd frontend
pnpm install
pnpm dev        # http://localhost:5173、/api は :8000 にプロキシ
```

テスト：`cd backend && pytest`。型チェックとビルド：`cd frontend && pnpm exec tsc --noEmit && pnpm build`。

## 設定

設定はすべて `.env` の環境変数で行います。全項目とコメントは [`.env.example`](./.env.example) にあります。主な項目は次のとおりです。

| 変数 | 既定値 | 用途 |
|---|---|---|
| `ADMIN_TOKEN` | — | 初期管理パスワード（ハッシュ化して保存） |
| `JWT_SECRET` | — | 管理セッションの署名鍵 |
| `SECRETS_KEY` | — | ローカルディスク上のファイルとデータベース内の秘密情報を暗号化する 32 バイトの鍵。未設定だとアプリは起動しません。 |
| `APP_URL` / `ALLOWED_ORIGINS` | `http://localhost:8000` | 公開 URL と CORS の許可リスト。本番環境で `*` は使わないでください。 |
| `STORAGE_BACKEND` | `local` | `local` または `s3`（Cloudflare R2 を含む任意の S3 互換サービス） |
| `S3_ENDPOINT_URL`、`S3_BUCKET_NAME`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` | — | `STORAGE_BACKEND=s3` のときのバケット認証情報 |
| `MAX_FILE_BYTES` | `10737418240` | 1 ファイルの上限（10 GiB） |
| `MAX_FILES_PER_SHARE` | `200` | 1 回の共有あたりのファイル数上限 |
| `STORAGE_QUOTA_BYTES` | 無制限 | すべての共有の合計ストレージ容量 |
| `RATE_LIMIT_UPLOAD_PER_MIN` / `_PER_HOUR` / `_PER_DAY` | `5` / `30` / `200` | IP ごとのアップロード回数制限 |
| `RATE_LIMIT_RETRIEVE_FAILS_PER_HOUR` | `20` | IP ごとに許容するコード入力ミスの回数。超えると一時的にブロック |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | 任意の Cloudflare Turnstile ボット対策 |

テーマ、ストレージ、レート制限、サインイン方法、サイトの文言は、管理画面からいつでも変更できます。これらはデータベースに保存され、秘密情報は暗号化されます。`ADMIN_TOKEN`、`JWT_SECRET`、`SECRETS_KEY` は `.env` にのみ置かれます。

本番構成、R2 バケットの CORS、リバースプロキシの注意点は [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) を参照してください。

## セキュリティ

Yui Drop は日常的な手早い共有のためのツールで、エンドツーエンド暗号化では**ありません**。サーバーはアップロードされた内容を読み取れます。ゼロ知識の共有が必要な場合は、[Magic Wormhole](https://github.com/magic-wormhole/magic-wormhole) など専用のツールを使ってください。

**暗号化**
- 通信中：すべて HTTPS。HTTPS で配信している場合は HSTS を送信します。
- 保存時：ローカルディスク上のファイルは、共有ごとに個別の鍵を使って AES-256-GCM で暗号化され、その鍵は `SECRETS_KEY` で保護されます。S3 / R2 上のオブジェクトはプロバイダーの AES-256 サーバー側暗号化を使います。
- 管理パスワードと API キーはハッシュのみを保存します。

**アップロードされたファイルの安全な配信**
- 各ファイルの `Content-Type` はサーバーが拡張子から決定し、アップロード側が申告した型は無視します。
- ページ内で直接表示するのは画像、音声、動画、PDF、プレーンテキストのみです。HTML、SVG、XML、スクリプトなど、それ以外はすべてダウンロードとして配信します。
- すべてのファイル応答に `X-Content-Type-Options: nosniff` とサンドボックス化された `Content-Security-Policy` を付けています。型を偽装したファイルでも、サイトのオリジンでスクリプトは実行できません。
- Markdown は生の HTML を無効にしてレンダリングし、DOMPurify でサニタイズします。危険なスキームへのリンクはただのテキストになります。外部画像は自動で読み込まないため、共有を開いても第三者のサーバーに通信は発生しません。

**悪用対策**
- 受け取りコードは推測しやすい並びを避けて生成します。同じ IP からの入力ミスが多すぎると一時的にブロックします。
- IP ごとのアップロード制限、全体のストレージ容量制限、任意の Turnstile に対応しています。
- マルチパートアップロードは完了時に実際のサイズを照合し、放棄されたアップロードは自動で片付けます。
- 管理画面のログインには回数制限があり、パスキーや OIDC も使えます。
- サイト全体に厳格な CSP、`frame-ancestors 'self'`、`Referrer-Policy`、`Permissions-Policy` を適用しています。クエリはすべてパラメータ化し、ファイル名はサニタイズしたうえで、保存パスはサーバー側で生成します。

**ログと保持**
- アクセスログには、悪用対応のため IP と User-Agent を記録します。IP の記録は管理画面でオフにできます。
- 期限切れの共有はまずごみ箱に移ります。管理者は復元または完全削除ができます。

脆弱性を見つけた場合は、公開 issue ではなく [GitHub Security Advisories](https://github.com/kurobaryo/yui-drop/security/advisories/new) から非公開で報告してください。

## アーキテクチャ

```
ブラウザ（React SPA）──► FastAPI ──► SQLite（メタデータ）
        │                   │
        │  署名付き          │   ローカルディスク（暗号化）
        └─ マルチパート ────►└── または S3 / R2 バケット
```

- **フロントエンド**：React 18、TypeScript、Vite、Zustand、TanStack Query、react-i18next、markdown-it、DOMPurify
- **バックエンド**：FastAPI、SQLAlchemy 2.0（async）、Alembic、Pydantic v2、cryptography
- **ストレージ**：共通の `StorageBackend` インターフェースに、ローカル実装と S3 互換実装を用意しています。

詳しくは [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) を参照してください。

## API

Web アプリ自体が使う内部エンドポイントとは別に、スクリプトや他のアプリ向けの安定した REST API を `/api/v1` で提供しています。管理者が管理画面でキーを発行し、`upload` と `read` の権限やキーごとの容量制限を設定できます。

- `POST /api/v1/upload`：小さなファイルを 1 リクエストでアップロード
- `POST /api/v1/upload/init` → `sign-part` → `complete`：大きなファイルをバケットへ直接マルチパートでアップロード
- `POST /api/v1/share/text`：テキスト共有を作成
- `POST /api/v1/pickup`：受け取りコードで受け取り
- `GET /api/v1/shares`、`GET /api/v1/shares/{code}`：そのキーで作成した共有の一覧と詳細

```bash
YUI_DROP_API_KEY=yd_... ./scripts/yui-drop-upload.sh ./report.pdf
YUI_DROP_API_KEY=yd_... ./scripts/yui-drop-upload.py ./video.mp4 --expire-value 7 --expire-style day
```

詳細は [`docs/API.md`](./docs/API.md) と、各インスタンスの `/docs` ページにあります。

## 運用

サーバー上の更新は `yuidrop` CLI で行います。

```bash
sudo ./scripts/install-yuidrop.sh   # 初回のみ
yuidrop update                      # 取得、再ビルド、マイグレーション、ヘルスチェック
yuidrop rollback                    # 1 つ前のバージョンに戻す
```

詳しくは [`scripts/README.md`](./scripts/README.md) を参照してください。

## ディレクトリ構成

```
backend/    FastAPI アプリ（api/、services/、models/、storage/）、Alembic マイグレーション、テスト
frontend/   React アプリ（v2/ が現行 UI、pages/admin/ が管理画面、i18n/ が翻訳）
scripts/    インストーラー、yuidrop CLI、アップロードクライアント
docs/       アーキテクチャ、デプロイ、API ドキュメントと画像
```

## ロードマップ

- 任意のクライアント側暗号化
- パスワード付き共有
- 受け取りコードの桁数設定
- フォルダーのアップロード
- ウイルススキャン連携

## ライセンス

[MIT](./LICENSE)
