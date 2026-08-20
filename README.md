# questboard

Questboard フロントエンド（Next.js, TypeScript, App Router, next-intl, FontAwesome）+ Rails バックエンド + Go sync-server によるリアルタイム共同編集ボード。

## Scripts

- `npm run dev` — フロント開発サーバーを起動
- `npm run build` — 本番ビルドを作成
- `npm start` — 本番サーバーを起動
- `npm test` — リポジトリのチェック一式を実行
- 各サブシステムの個別コマンドは `CLAUDE.md` の「開発コマンド」を参照

## Development environment

Development と test の Rails backend は PostgreSQL を使う。ローカル手順は [src/backend/README.md](src/backend/README.md) を参照。

- `docker compose up -d postgres`
- `cp src/backend/.env.example src/backend/.env`
- `cd src/backend && bundle exec rails db:prepare`

## 自動ログイン手順（開発環境）

開発環境（`NEXT_PUBLIC_ENV` / Rails環境が development）では認証済み状態として分岐するため、Xログインなしでそのまま各ページ・APIにアクセスできる。本番ビルドにはこの近道は存在しない。

## Pages

表示言語は日本語のみ。URL にロケール接頭辞は付かない。

### フロントエンド（Next.js）

- `/` — Xサインイン付きのランディングページ
- `/auth/x/callback` — X OAuthコールバック・reCAPTCHA検証
- `/b/{shareToken}` — ボードキャンバス画面（共有トークンでアクセス）
- `/board-layout-fixture` — ボードレイアウト回帰確認用の開発フィクスチャ（開発環境、または`NEXT_PUBLIC_ENABLE_LAYOUT_FIXTURE=true`時のみ有効。それ以外は404）
- `/legal` — 利用規約・プライバシーポリシー・運営者情報・問い合わせ・特定商取引法の案内

### バックエンド管理画面（Rails、Basic認証）

- `/admin` — KPI開発者ダッシュボード（D1/D7継続率・同時編集人数・クエスト完了率等）
- `/admin/users` — ユーザー検索・手動許可（`is_manual_member`）管理

## API一覧

詳細は [`SPEC/api/`](SPEC/api/) を参照。

- Rails バックエンド: [`SPEC/api/rails-backend.md`](SPEC/api/rails-backend.md)
- Go sync-server（WebSocket）: [`SPEC/api/sync-server.md`](SPEC/api/sync-server.md)
- フロントエンド（Next.js Route Handler）: [`SPEC/api/frontend.md`](SPEC/api/frontend.md)
  - `GET /api/instance` — 送った識別子が稼働中の Next プロセスのものと一致するかを答える（テスト用。本番では未設定のため常に 404。`QUESTBOARD_INSTANCE_ID`環境変数で識別子を設定）

## Authentication

- Frontend env: `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_SYNC_SERVER_URL`, `NEXT_PUBLIC_X_CLIENT_ID`, `NEXT_PUBLIC_X_REDIRECT_URI`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `NEXT_PUBLIC_ENV`, `NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_ENABLE_LAYOUT_FIXTURE`
  - `NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE` は利用不可画面のフォロー案内に出す対象アカウントのハンドル（先頭の `@` は任意）。未設定だと案内が成立しないため既定値へは倒さず例外にする
  - `NEXT_PUBLIC_ENABLE_LAYOUT_FIXTURE` は `/board-layout-fixture` を本番ビルドでも有効化するフラグ（既定は開発環境のみ有効）
- Backend env: `X_OAUTH_CLIENT_ID`, `X_OAUTH_REDIRECT_URI`, `RECAPTCHA_SECRET_KEY`, `X_FOLLOWER_GATE_TARGET_ACCOUNT_ID`, `X_FOLLOWER_CACHE_SYNC_BEARER_TOKEN`, `X_FOLLOWER_CACHE_SYNC_PAGE_SIZE`, `X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES`, `X_FOLLOWER_GATE_BYPASS_USER_IDS`, `X_FOLLOWER_CACHE_FULL_SYNC_INTERVAL_HOURS`, `ADMIN_BASIC_AUTH_USERNAME`, `ADMIN_BASIC_AUTH_PASSWORD`, `CORS_ALLOWED_ORIGINS`, `SYNC_SERVER_REDIS_URL`, `SYNC_SERVER_REDIS_CHANNEL_PREFIX`, `SYNC_SERVER_REDIS_POOL_SIZE`, `SENTRY_DSN`
  - `X_FOLLOWER_GATE_MANUAL_RECHECK_COOLDOWN_MINUTES` は手動再判定のクールダウン（分。既定15）。正の整数以外を設定すると起動時に例外になる
  - `ADMIN_BASIC_AUTH_USERNAME`/`ADMIN_BASIC_AUTH_PASSWORD` は `/admin` 配下のBasic認証情報。テスト環境のみ既定値`admin`/`secret`が自動設定される（`config/initializers/admin_auth.rb`）。development/production では未設定のまま起動すると例外になるため、`.env`で必ず設定すること（リポジトリにはコミットしない）
  - `SYNC_SERVER_REDIS_URL`/`SYNC_SERVER_REDIS_CHANNEL_PREFIX`/`SYNC_SERVER_REDIS_POOL_SIZE` はRailsからGo sync-serverへ同期opをRedis経由でリレーする設定
- Sync server env: `SYNC_SERVER_ENV`, `SYNC_SERVER_ADDR`/`PORT`, `SYNC_SERVER_ALLOWED_ORIGINS`, `SYNC_SERVER_BACKEND_URL`, `SYNC_SERVER_SHARD_COUNT`, `SYNC_SERVER_NODE_ID`, `SYNC_SERVER_REDIS_URL`, `SYNC_SERVER_REDIS_CHANNEL_PREFIX`, `SYNC_SERVER_METRICS_TOKEN`
  - `SYNC_SERVER_METRICS_TOKEN` は `/metrics` を守る共有トークン。設定すると `Authorization: Bearer <token>` を要求し、一致しなければ 401 を返す。**`SYNC_SERVER_ENV=production` では必須で、未設定だと起動時に失敗する**（未設定のまま公開ドメインに出ると誰でも読める。issue #229）。development では未設定を許容する
  - `/healthz` は外形監視から叩くため認証をかけない
- Development mode treats the app as already authenticated; this branch is not present in production builds

## Localization

表示言語は日本語のみで、多言語対応は行わない。メッセージカタログは `src/messages/ja.json` の1つだけで、
UI の文字列はすべて翻訳キー経由で参照する（JSX に直書きしたテキストは `test/scaffold.test.mjs` の
`UI source does not contain hardcoded JSX text` が検査する。`placeholder` や `aria-label` のように
props へ渡す文字列は検査対象外なので、レビューで確認する）。
カタログを増やすと URL 接頭辞・ロケール検出・未翻訳の扱いが再び必要になるため、言語追加は方針変更（`CLAUDE.md`）を伴う。

## Design tokens

CSS custom properties are defined in `src/styles/tokens/*.css` and imported by `src/app/globals.css`.
