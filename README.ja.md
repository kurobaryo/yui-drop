<div align="center">

# Yui-Drop

### 6桁の暗証番号でファイルとテキストを共有するセルフホスト型ファイル宅配ロッカー

[English](./README.md) · [中文](./README.zh.md) · 日本語 (このページ)

[ライブデモ](https://drop.leod.me) · [クイックスタート](#quick-start)

</div>

---

## 概要

Yui-Drop は、モダンでセルフホスト可能な「ファイル宅配ロッカー」です。ファイルを投函する（あるいはテキストを貼り付ける）と、6桁の暗証番号が発行されます。あとはその番号を相手に伝えるだけ。アカウント登録もリンク共有もメール送信も不要で、電話口で読み上げられるシンプルな数字ひとつで完結します。

[vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) に着想を得た完全な書き直し版で、Linear 風の UI、モバイルファーストのレイアウト、モダンな Python / JS スタック（FastAPI + React 18）、より厳格なデフォルトのセキュリティ設定、そして Cloudflare R2 / S3 のマルチパート直接アップロードを軸に構築されています。API サーバーが大きなファイルに触れることはありません。

Yui-Drop is a modern, self-hostable "file-codebox": drop a file (or paste a text snippet), get a short 6-digit pickup code, share the code, done. No accounts, no links, no email — just a number you can read out over the phone.

It's a fresh rewrite inspired by [vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox), built around a Linear-style UI, mobile-first layout, modern Python/JS stacks (FastAPI + React 18), tighter security defaults, and Cloudflare R2 / S3 multipart direct-upload so the API server never touches large files.

---

<div align="center">

🔒 **デフォルトで安全** — TLS 1.3、保存時 AES-256 暗号化（R2 SSE）、厳格な CSP、レート制限
✨ **モダンなスタック** — React 18、FastAPI、SQLAlchemy 2.0、S3 マルチパート直接アップロード
📦 **セルフホスト** — `docker compose up` 一発でスタック全体をデプロイ

🔒 **Secure by design** — TLS 1.3, AES-256 at-rest (R2 SSE), strict CSP, rate-limited
✨ **Modern stack** — React 18, FastAPI, SQLAlchemy 2.0, S3 multipart direct upload
📦 **Self-hosted** — single `docker compose up` deploys the whole stack

</div>

---

## 機能

- 🔑 **6桁の暗証番号** — 短く、覚えやすく、口頭でも共有しやすい
- 📁 **ファイルとテキスト** — 最大 10 GB のファイルをアップロード、あるいはテキストを貼り付け
- 👁️ **ブラウザ内プレビュー** — 画像、PDF、動画、音声、テキスト、Markdown をその場で表示。ダウンロードは必要なときだけ
- 🪣 **差し替え可能なストレージ** — ローカルファイルシステム、S3 / Cloudflare R2（マルチパート直接アップロード対応）、OneDrive、WebDAV
- ⚡ **バケットへの直接アップロード** — 大きなファイルはブラウザからバケットへ直接ストリーミング。再開可能、パートの並列送信、失敗時の自動リトライに対応
- 🎨 **5種類のアクセントカラー** + ライト / ダーク / システム連動モード。すべてデバイスごとに保存
- 🌐 **3言語の UI** — English、简体中文、日本語。自動検出かつ手動で切り替え可能
- 🛡️ **セキュリティ最優先** — 下記の [セキュリティ](#security) を参照
- 🗑️ **ソフトデリート + 管理者用ゴミ箱** — 期限切れや管理者が削除した共有は、管理者がゴミ箱を空にするまで復元可能

## アーキテクチャ

```
┌──────────────┐      ┌──────────────┐      ┌──────────────────┐
│   React SPA  │◄────►│   FastAPI    │◄────►│   SQLite / DB    │
│  Vite + TS   │      │  Python 3.12 │      │ （メタデータのみ）│
└──────┬───────┘      └──────┬───────┘      └──────────────────┘
       │                     │
       │  multipart 直接送信 │  presign / complete
       └─────────────┐ ┌─────┘
                     ▼ ▼
              ┌──────────────────┐
              │   オブジェクト   │
              │   ストレージ     │
              │  (R2 / S3 / FS)  │
              └──────────────────┘
```

- **フロントエンド** — React 18、Vite、TypeScript、Tailwind、react-i18next、TanStack Query、Zustand、lucide-react
- **バックエンド** — FastAPI、SQLAlchemy 2.0（async）、Alembic マイグレーション、Pydantic v2、structlog、slowapi
- **ストレージ抽象化** — 単一の `StorageBackend` インターフェース。`.env` でバックエンドを切り替え可能
- S3 / R2 利用時は **ファイルが API サーバーを通過しません** — ブラウザから presigned multipart URL 経由でバケットへ直接送信されます

## クイックスタート

### ワンライナーインストール（推奨）

```bash
curl -fsSL https://raw.githubusercontent.com/kurobaryo/yui-drop/main/scripts/install.sh | bash
```

インストーラーは次の処理を行います：
1. リポジトリを `./yui-drop` にクローン
2. 強力なランダム値の `ADMIN_TOKEN` と `JWT_SECRET` を生成
3. 初期 `.env` を書き出し（オブジェクトストレージを使う場合は後でバケット向けに編集します）
4. `docker compose up -d --build` を実行
5. 管理画面の URL と token を表示

その後、ブラウザで <http://localhost:8000> を開いてください。デフォルトのストレージバックエンドはローカルファイルシステムなので、まず試してみるのに最適です。

### 手動インストール

```bash
# 1. クローン
git clone https://github.com/kurobaryo/yui-drop.git
cd yui-drop

# 2. シークレットを生成し .env を作成
cp .env.example .env
# .env を編集 — 少なくとも ADMIN_TOKEN、JWT_SECRET、必要に応じて S3 / R2 の認証情報を設定

# 3. 起動
docker compose up -d --build

# 4. ブラウザで開く
open http://localhost:8000
```

### 開発環境（Dockerなし）

```bash
# バックエンド
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# フロントエンド（別のターミナルで）
cd frontend
pnpm install
pnpm dev   # → http://localhost:5173、/api を :8000 へプロキシ
```

## 設定

設定はすべて環境変数（`.env`）で行います。完全なリストは [`.env.example`](./.env.example) を参照してください。主な変数は以下のとおりです：

| 変数 | デフォルト | 用途 |
|---|---|---|
| `ADMIN_TOKEN` | *ランダム* | 初期管理者パスワード（初回起動時にハッシュ化されます） |
| `JWT_SECRET`  | *ランダム* | サーバー側 JWT 署名鍵 |
| `STORAGE_BACKEND` | `local` | `local`、`s3`、`onedrive`、`webdav` |
| `S3_ENDPOINT_URL` | *(空)* | 例：`https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET_NAME`  | *(空)* | アップロードファイルを保管するバケット |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | *(空)* | R2 / S3 の認証情報 |
| `RATE_LIMIT_UPLOAD_PER_MIN` | `5` | IP ごとのアップロードレート制限 |
| `RATE_LIMIT_RETRIEVE_FAILS_PER_HOUR` | `20` | IP ごとの取得失敗回数上限（自動 BAN） |
| `MAX_UPLOAD_BYTES` | `10737418240` | 単一ファイルサイズの上限（デフォルト 10 GiB） |
| `STORAGE_QUOTA_BYTES` | *(無制限)* | すべての共有を合計したストレージ容量上限 |
| `EXPIRE_SWEEPER_INTERVAL_MIN` | `10` | ソフトデリートの定期処理の実行間隔 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | *(空)* | 任意の Cloudflare Turnstile ボット対策 |
| `ALLOWED_ORIGINS` | *(デプロイ先ホスト)* | CORS のホワイトリスト。本番環境では絶対に `*` にしないこと |

管理者が実行時に変更できる設定（ストレージ認証情報、レート制限、UI ラベルなど）は DB に保存され、`/admin/settings` から編集できます。機密性の高いシークレット（`ADMIN_TOKEN`、`JWT_SECRET`）は `.env` に残り、DB に書き戻されることはありません。

## セキュリティ

UI に表示される *「🔒 安全加密 · 匿名」* バッジの裏付けは次のとおりです。

### 暗号化される対象

- **通信経路** — クライアント ↔ サーバー間の通信はすべて HTTPS（TLS 1.3）。Caddy / Nginx Proxy Manager と Let's Encrypt を組み合わせて配置することを推奨します。
- **バケット内の保存時データ** — Cloudflare R2 および AWS S3 は、すべてのオブジェクトを AES-256 でサーバーサイド暗号化（SSE）します。クライアント側の作業は不要で、鍵はストレージプロバイダーが管理します。これは「ディスクが盗まれる」「物理メディアが押収される」といった脅威モデルをカバーします。
- **管理者パスワード** — ソルト付きハッシュとして保存。生のトークンは `.env` にのみ存在します。
- **JWT** — HS256 / RS256 で署名。シークレットは `.env` にあります。

> Yui-Drop はエンドツーエンド暗号化を *行いません*。目的は日常的なファイルを手軽に共有することにあります — 電話口で読み上げられる暗証番号、それがコンセプトです。サーバー側ですら読めないという証明可能なゼロ知識性が必要であれば、別のツールを検討してください：[Send](https://send.vis.ee)、[Wormhole](https://wormhole.app)、[Magic-Wormhole](https://github.com/magic-wormhole/magic-wormhole)。

### 防御される脅威

| 脅威 | 防御策 |
|---|---|
| SQL インジェクション | 全面的に SQLAlchemy 2.0 のパラメータ化クエリを利用。SQL に文字列連結を行いません |
| XSS（アップロードされた HTML / SVG） | SVG は強制ダウンロード（プレビューしない）。HTML ファイルも強制ダウンロード。テキスト / Markdown は `text/plain` として配信し、DOMPurify を通してレンダリング |
| CSRF | 純粋な Bearer JWT のみ。Cookie 認証や暗黙的な認証情報は使用しません |
| 暗証番号の総当たり攻撃 | IP ごとに 20 回失敗で 1 時間のソフト BAN。低エントロピーなパターン（`123456`、`111111` など）は生成時に回避 |
| ストレージへのフラッディング | IP ごとのアップロード上限（5/分、30/時、200/日）、グローバルなストレージクォータ（管理者が設定可）、1 時間ごとに孤児となった multipart をクリーンアップ |
| マルチパートでのサイズ偽装 | `complete` ステップで実オブジェクトを HEAD し、申告サイズと実サイズの差が 5% を超える場合は拒否 |
| 管理画面への総当たり攻撃 | `/admin/login` に対し IP ごと 5 分あたり 10 回までの上限と指数バックオフ |
| クリックジャッキング / フレーム埋め込み | `X-Frame-Options: DENY` および `Content-Security-Policy: frame-ancestors 'none'` |
| MIME スニッフィング | `X-Content-Type-Options: nosniff` |
| `Content-Disposition` へのヘッダーインジェクション | ファイル名をサニタイズし、RFC 5987 でエンコード |
| オープンリダイレクト | ユーザー入力に由来するリダイレクト先は一切受け付けません |
| パストラバーサル | ファイル名をサニタイズ（`..`、制御文字、Windows の予約名を排除）。ファイルパスはサーバー側の UUID から導出し、ユーザー入力を信頼しません |

Cloudflare Turnstile によるボット対策も組み込まれていますが、**デフォルトでは無効**です。`.env` にサイトキーとシークレットを設定したうえで、管理画面から有効化してください。

### ログと保持期間

- **アクセスログにはクライアント IP と User-Agent が含まれます**。乱用調査のためで、管理者は `/admin/logs` から検索できます。
- **ソフトデリート** — 期限切れや管理者によって削除された共有には `deleted_at` フラグが付くだけで、バケット上のオブジェクトは残ります。管理者はゴミ箱から復元するか、ハードデリート（バケット上のオブジェクトも削除）できます。
- **自動定期処理** が `EXPIRE_SWEEPER_INTERVAL_MIN` 分ごとに実行され、期限切れの行をソフトデリートし、孤児になったマルチパートセッションを中止します。

## リポジトリ構成

```
yui-drop/
├── README.md              ← English（デフォルト）
├── README.zh.md           ← 中文
├── README.ja.md           ← 日本語（本ファイル）
├── LICENSE                ← MIT
├── docker-compose.yml     ← ワンコマンドでデプロイ
├── .env.example           ← 設定可能な全環境変数（コメント付き）
├── scripts/
│   ├── install.sh         ← ワンライナーインストールスクリプト
│   └── ...                ← 運用補助
├── backend/               ← Python · FastAPI · SQLAlchemy 2.0
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── alembic.ini · alembic/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/           ← ルートモジュール
│   │   ├── core/          ← 設定、セキュリティ、依存性
│   │   ├── db/            ← session、base
│   │   ├── models/        ← SQLAlchemy モデル
│   │   ├── schemas/       ← Pydantic v2 DTO
│   │   ├── services/      ← ビジネスロジック
│   │   └── storage/       ← 各ストレージバックエンドの実装
│   └── tests/
├── frontend/              ← React 18 · Vite · TypeScript
│   ├── package.json
│   ├── Dockerfile
│   ├── vite.config.ts · tailwind.config.ts · tsconfig.json
│   ├── public/
│   └── src/
│       ├── main.tsx · App.tsx
│       ├── routes/                ← ルートコンポーネント
│       ├── components/ui/         ← Linear 風の原子コンポーネント
│       ├── components/motion/     ← アニメーション演出
│       ├── pages/                 ← ページレベルのコンポーネント
│       ├── hooks/ · api/ · stores/
│       ├── i18n/locales/{en,zh-CN,ja}.json
│       └── styles/
└── docs/
    ├── ARCHITECTURE.md
    ├── API.md             ← REST 仕様 + OpenAPI へのリンク
    └── DEPLOYMENT.md
```

## API

バックエンドは `GET /api/openapi.json` で OpenAPI 仕様を、`GET /api/docs` で対話的な Swagger UI を提供します。概要は [`docs/API.md`](./docs/API.md) を参照してください。

## ロードマップ

- [ ] 任意で有効化できるクライアントサイド暗号化（`?c=…&k=…` 形式）
- [ ] 暗証番号の桁数のカスタマイズ（5〜8桁）
- [ ] WebPush / メールによる有効期限通知
- [ ] フォルダアップロード（自動 zip 化）
- [ ] 共有ごとのパスワード保護
- [ ] ClamAV スキャンフック

## 謝辞

[vastsa/FileCodeBox](https://github.com/vastsa/FileCodeBox) に着想を得ています — 「暗証番号で共有する」というアイデアを切り拓いた、元祖の匿名ファイル共有サービスです。Yui-Drop は、Linear 風の UI、モバイルファーストの体験、モダンな Python / JS スタック、より厳格なデフォルトのセキュリティ設定にフォーカスした、独立した書き直しです。アップストリームとソースコードは共有していません。

## ライセンス

MIT — [LICENSE](./LICENSE) を参照してください。
