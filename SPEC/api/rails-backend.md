# Rails バックエンド API

`src/backend` (Ruby on Rails)。認証は `_questboard_session` の暗号化セッションCookie（Googleログイン、`session_controller.rb` 参照）。以下は現時点で実装済みのエンドポイントのみを記載する。実装ソースは `src/backend/config/routes.rb`。

## ヘルスチェック

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/healthz` | 死活監視用 |

## 認証・セッション

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/auth/google_sessions` | Google IDトークン（+ reCAPTCHA）を検証し、セッションCookieを発行 |
| GET | `/session` | 現在のログイン状態とユーザー情報を返す（未認証時 401） |
| DELETE | `/session` | ログアウト（セッション破棄） |

## ボード

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/boards` | ボードを新規作成し、作成者をownerとして登録 |
| GET | `/boards/:share_token` | ボードとその全オブジェクトを取得（キャンバス初期ロード用） |
| POST | `/boards/:share_token/join` | 共有トークン経由でボードに参加（招待ロールを指定） |
| PATCH | `/boards/:share_token/members/:user_id` | メンバーのロールを変更（owner権限、最後のownerの降格は禁止） |

## オブジェクト（付箋・図形）

`property`（`geometry` / `color` / `deleted_at`）ごとに [Lamportタイムスタンプ](../F1-input-intent-resolution.md)で同時編集を解決する `apply_op` が中核。`move`/`resize`/`rotate`/`recolor`/`destroy` はレガシー経路（`client_id: "legacy"` として同じLamport順序に記録される）。

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/boards/:share_token/objects` | オブジェクトを新規作成 |
| PATCH | `/boards/:share_token/objects/:id/move` | 移動（レガシー経路） |
| PATCH | `/boards/:share_token/objects/:id/resize` | リサイズ（レガシー経路） |
| PATCH | `/boards/:share_token/objects/:id/rotate` | 回転（レガシー経路） |
| PATCH | `/boards/:share_token/objects/:id/color` | 色変更（レガシー経路） |
| POST | `/boards/:share_token/objects/:id/duplicate` | 複製 |
| POST | `/boards/:share_token/objects/:id/lock` | フレームロックを取得 |
| DELETE | `/boards/:share_token/objects/:id/lock` | フレームロックを解除 |
| POST | `/boards/:share_token/objects/:id/ops` | Lamport順序付きop（`property`/`value`/`lamport_ts`/`client_id`）を適用。同時編集は`property`単位・同一tsは`client_id`昇順でタイブレーク。競合時 409、削除済みオブジェクトへの編集は `409 { restoreSuggested: true }`。`deleted_at` op は `value.restore: true` で復元できる |
| DELETE | `/boards/:share_token/objects/:id` | 論理削除（30日間tombstoneとして保持後、パージ対象） |

## コメント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/boards/:share_token/objects/:object_id/comments` | コメント一覧取得 |
| POST | `/boards/:share_token/objects/:object_id/comments` | コメント作成（KPIイベント記録を伴う） |
| PATCH | `/boards/:share_token/objects/:object_id/comments/:id` | コメント編集 |
| DELETE | `/boards/:share_token/objects/:object_id/comments/:id` | コメント削除 |

## 管理画面（開発者向け）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/admin` | 管理ダッシュボード。`ADMIN_BASIC_AUTH_USERNAME`/`ADMIN_BASIC_AUTH_PASSWORD` によるBasic認証。現状はステータス確認用のJSONスタブ |

Basic認証情報は環境変数で渡し、リポジトリにはコミットしないこと（`CLAUDE.md` シークレット管理参照）。
