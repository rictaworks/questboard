# Go sync-server API

`src/sync-server`（Gin + gorilla/websocket）。ボードのリアルタイム共同編集opを配信する。実装ソースは `src/sync-server/internal/ws/handler.go`, `internal/server/server.go`。

## エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/healthz` | 死活監視用 |
| GET | `/metrics` | Prometheus形式のメトリクス（接続数、遅いクライアント切断数など） |
| GET | `/ws?boardId=:boardId` | WebSocket接続。同一boardIdの接続同士でopをブロードキャストする |

## `/ws` 接続

- **Origin検証**: 許可されたOriginのみ受け付ける（Rails認証より前にチェックし、不正Originからの認証リクエスト増幅を防止）
- **認証**: `Authorization: Bearer <token>` ヘッダ、または `_questboard_session` Cookie（Railsのセッションと同じCookie名）。トークンはRailsバックエンドへ問い合わせて検証する
- 複数ボードをシャーディングで分散する `sharding.Router` により、`boardId` から担当ノードを解決する

## メッセージ形式（クライアント→サーバー）

```json
{
  "boardId": "string",
  "objectId": "string",
  "property": "geometry" | "color" | "deleted_at",
  "value": { "...": "..." },
  "lamport_ts": 0,
  "clientId": "string"
}
```

`property: "presence"` の場合は `value.cursor` に加えて任意で `value.displayName` を含められる。表示名はクライアントが送信した実表示名をそのまま中継し、受信側はその文字列をカーソルラベルとして描画する。

## メッセージ形式（サーバー→クライアント、確定op）

Rails側で実際に永続化された値を配信する（クライアントが送った値そのものではない）。

```json
{
  "property": "geometry" | "color" | "deleted_at",
  "value": { "...": "..." },
  "lamportTs": 0,
  "clientId": "string"
}
```

## メッセージ形式（サーバー→送信元、削除済みオブジェクトへの編集拒否）

削除済み（tombstone化された）オブジェクトへ編集opを送った場合、他クライアントへは配信されず、送信元にのみ復元提案付きの通知が返る。接続は維持される。

```json
{
  "objectId": "string",
  "error": "Object has been deleted; restore it before editing",
  "restoreSuggested": true
}
```

復元アクションは `deleted_at` op の `value.restore: true` を送信する。復元できるかどうかはクライアント側の権限判定に従う。

## 接続クローズの扱い

- 同一lamport_ts以下の古いop（`ErrStaleOp`）: ブロードキャストせず`continue`。接続は維持
- 送信キューが溢れている遅いクライアント: 該当クライアントの接続を`ClosePolicyViolation`でクローズ（黙って通知を破棄しない）
- サポート対象外の`property`のop: `CloseUnsupportedData`でクローズ

## Redis中継

複数の sync-server ノード間でopを配信するため、Redis pub/subを使用する（`internal/ws/relay_redis.go`）。チャネル接頭辞・プールサイズは環境変数で設定する（`SYNC_SERVER_REDIS_URL` 等。`CLAUDE.md`の開発コマンド節、`src/backend/.env.example`参照）。
