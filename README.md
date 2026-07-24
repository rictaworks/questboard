# questboard

Questboard フロントエンド（Next.js, TypeScript, App Router, next-intl, FontAwesome）+ Rails バックエンド + Go sync-server によるリアルタイム共同編集ボード。

## Scripts

- `npm run dev` — フロント開発サーバーを起動
- `npm run build` — 本番ビルドを作成
- `npm start` — 本番サーバーを起動
- `npm test` — リポジトリのチェック一式を実行
- 各サブシステムの個別コマンドは `CLAUDE.md` の「開発コマンド」を参照

## 自動ログイン手順（開発環境）

開発環境（`NEXT_PUBLIC_ENV` / Rails環境が development）では認証済み状態として分岐するため、Googleログインなしでそのまま各ページ・APIにアクセスできる。本番ビルドにはこの近道は存在しない。

## Pages

- `/` — デフォルトロケールへリダイレクト
- `/{locale}` — Googleサインイン付きのロケール別ランディングページ（`ja`, `en`, `fr`, `zh`, `ru`, `es`, `ar`）
- `/auth/google/callback` — Google OAuthコールバックのエイリアス
- `/{locale}/auth/google/callback` — Google OAuthコールバック・reCAPTCHA検証
- `/{locale}/b/{shareToken}` — ボードキャンバス画面（共有トークンでアクセス）

## API一覧

詳細は [`SPEC/api/`](SPEC/api/) を参照。

- Rails バックエンド: [`SPEC/api/rails-backend.md`](SPEC/api/rails-backend.md)
- Go sync-server（WebSocket）: [`SPEC/api/sync-server.md`](SPEC/api/sync-server.md)

## Authentication

- Frontend env: `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_SYNC_SERVER_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_REDIRECT_URI`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `NEXT_PUBLIC_ENV`
- Backend env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `RECAPTCHA_SECRET_KEY`
- Development mode treats the app as already authenticated; this branch is not present in production builds

## Localization

Messages live in `src/messages/*.json` and should be referenced by translation keys only.

## Design tokens

CSS custom properties are defined in `src/styles/tokens/*.css` and imported by `src/app/globals.css`.
