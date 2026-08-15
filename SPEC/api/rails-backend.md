# Rails バックエンド API

`src/backend` (Ruby on Rails)。認証は `_questboard_session` の暗号化セッションCookie（Xログイン、`session_controller.rb` 参照）。以下は現時点で実装済みのエンドポイントのみを記載する。実装ソースは `src/backend/config/routes.rb`。

## ヘルスチェック

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/healthz` | 死活監視用。DB接続が失敗すると 503 を返す |
| POST | `/client_errors` | フロントエンドからの例外レポートを受け付け、ログに集約する |

## 認証・セッション

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/auth/x_sessions` | XユーザーID（+ reCAPTCHA）を検証し、セッションCookieを発行 |
| GET | `/session` | 現在のログイン状態とユーザー情報を返す（未認証時 401） |
| DELETE | `/session` | ログアウト（セッション破棄） |
| POST | `/session/recheck` | フォロー状態を手動で再判定し、プラン値を更新して返す。クールダウン（既定15分）が未経過なら 429 と残り時間を返す |

## ボード

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/boards` | ボードを新規作成し、作成者をownerとして登録 |
| GET | `/boards/:share_token` | ボードとその全オブジェクトを取得（キャンバス初期ロード用）。各オブジェクトの `textCrdt`（後述のDelta形式）と `textCrdtRevision`（次の`text_crdt` opで`ref_revision`として送るべき値）を含む |
| DELETE | `/boards/:share_token` | ボードを削除（owner権限のみ） |
| POST | `/boards/:share_token/join` | 共有トークン経由でボードに参加（招待ロールを指定） |
| PATCH | `/boards/:share_token/members/:user_id` | メンバーのロールを変更（owner権限、最後のownerの降格は禁止） |

## オブジェクト（付箋・図形）

`property`（`geometry` / `color` / `deleted_at` / `text_crdt`）ごとにLamportタイムスタンプで同時編集を解決する `apply_op` が中核。`move`/`resize`/`rotate`/`recolor`/`destroy` はレガシー経路（`client_id: "legacy"` として同じLamport順序に記録される）。

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
| POST | `/boards/:share_token/objects/:id/ops` | Lamport順序付きop（`property`/`value`/`lamport_ts`/`client_id`）を適用。同時編集は`property`単位・同一tsは`client_id`昇順でタイブレーク。競合時 409、削除済みオブジェクトへの編集は `409 { restoreSuggested: true }`（`deleted_at` op は `value.restore: true` で復元できる）、`text_crdt`の再同期要求は `409 { resyncRequired: true }`。レスポンスには常に既存opの再送だったかを示す `duplicate` を含む |
| DELETE | `/boards/:share_token/objects/:id` | 論理削除（30日間tombstoneとして保持後、パージ対象） |

### `text_crdt`（テキストの共同編集）

他の`property`と異なり、`value`はテキスト全体ではなくDelta形式の差分を表す。

```json
{
  "property": "text_crdt",
  "value": {
    "ops": [{ "retain": 5 }, { "insert": " world", "attributes": { "bold": true } }],
    "ref_revision": 42
  },
  "lamport_ts": 3,
  "client_id": "client-a"
}
```

- `ops` は `insert` / `delete` / `retain` のいずれか一つを持つ操作の配列。`insert`・`retain`には任意で`attributes`（書式）を付与できる。オフセットはブラウザ文字列と同じUTF-16 code unit単位（絵文字などBMP外文字は2 code unit）
- `ref_revision` はクライアントが最後に観測したサーバー採番のrevision（`GET /boards/:share_token`の`textCrdtRevision`、または直前の`apply_op`レスポンスの`revision`）。履歴が存在するオブジェクトでは必須で、省略時・不正値（存在しない/他オブジェクトのもの/上限を超えて古い）は`409 { resyncRequired: true }`
- サーバーは`ref_revision`より後に確定した他クライアントの操作に対してOT（Operational Transformation）変換してから、`objects.text_crdt`（Delta形式の永続スナップショット、`attributes`込み）へ合成する
- レスポンスの`value`には、変換後の`ops`・エコーバックされた`ref_revision`・このop自身のrevision（`revision`、次回`ref_revision`として使う）を含む
- `delete`/`retain`は正の整数のみ許可。文書長を超える消費、UTF-16サロゲートペア境界を割る位置は`422`で拒否
- 1リクエストあたりのop件数・insert文字列のバイト数・attributes単体のバイト数と深さには上限があり、超過時は`422`。合成後の文書全体（本文＋全runのattributes合計）のバイト数にも別途上限があり、多数のrunに書式を分散させて肥大化させることはできない

## コメント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/boards/:share_token/objects/:object_id/comments` | コメント一覧取得 |
| POST | `/boards/:share_token/objects/:object_id/comments` | コメント作成（KPIイベント記録を伴う） |
| PATCH | `/boards/:share_token/objects/:object_id/comments/:id` | コメント編集 |
| DELETE | `/boards/:share_token/objects/:object_id/comments/:id` | コメント削除 |

## ユーザー設定

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/user_settings` | ログインユーザーの演出強度設定（`full`/`subtle`/`off`）を取得。無ければ既定値`full`で作成して返す |
| PATCH | `/user_settings` | 演出強度設定を更新（`intensity`必須。許可値以外は422） |

## KPI計測イベント

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/kpi_events` | クライアント計測イベント（`radial_opened`/`camera_panned`/`camera_zoomed`/`intensity_changed`）をバッチ登録。イベント種別ごとに許可属性をホワイトリスト検証し、PIIらしき値（氏名・メール・電話番号等）を含む場合は拒否する。1分あたり100リクエスト、1リクエスト20件・64KBまで |

## クエスト（F5 オンボーディング）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/quests` | ログインユーザーの全クエスト進行状況を取得（未作成分は初回アクセス時に生成） |
| POST | `/quests/:id/skip` | クエストをスキップ |
| POST | `/quests/:id/reopen` | スキップ済みクエストを再開 |
| POST | `/quests/:id/claim` | 達成済みクエストの報酬を受け取る |

## 管理画面（開発者向け、Basic認証）

`ADMIN_BASIC_AUTH_USERNAME`/`ADMIN_BASIC_AUTH_PASSWORD` によるBasic認証（`admin/base_controller.rb`）。Basic認証情報は環境変数で渡し、リポジトリにはコミットしないこと（`CLAUDE.md` シークレット管理参照）。

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/admin` | KPIダッシュボード（HTML）。D1/D7継続率・同時編集人数・ラジアルメニュー到達率・クエスト完了率・演出強度分布等を表示 |
| GET | `/admin/users` | ユーザー検索・一覧、フォロワーキャッシュ検索・一覧を表示 |
| POST | `/admin/users` | `x_user_id`/`display_name`を指定してユーザーを手動作成し、`member`プラン・`is_manual_member: true`を付与 |
| PATCH | `/admin/users/:id/toggle_bypass` | ユーザーの手動許可（`is_manual_member`）を切り替える。解除時はフォロワーゲートのロジックからプランを再計算する |

## 監視/エラートラッキング

- フロント/バックエンドの例外は Sentry を第一経路として集約し（`SENTRY_DSN` 設定時）、Sentry 未設定時のみ `POST /client_errors` と Rails のエラーログへフォールバックする。
- `/healthz` の外形監視ポーリング・アラート通知は未実施（詳細は [`SPEC/ops-maintenance.md`](../ops-maintenance.md) 参照）。
