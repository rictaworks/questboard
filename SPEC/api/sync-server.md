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
  "property": "geometry" | "color" | "deleted_at" | "text_crdt" | "presence",
  "value": { "...": "..." },
  "lamport_ts": 0,
  "clientId": "string"
}
```

`objectId`・`clientId`にはそれぞれ長さ上限（`MaxObjectIDBytes`/`MaxClientIDBytes`、共に128バイト）があり、超過は`Validate()`エラーとして扱われる（後述の接続クローズを参照）。

## メッセージ形式（サーバー→クライアント、確定op）

Rails側で実際に永続化された値を配信する（クライアントが送った値そのものではない）。`text_crdt`の場合、`value`にはOT変換後の`ops`とサーバー採番の`revision`（次のopの`ref_revision`に使う）が含まれる。

```json
{
  "property": "geometry" | "color" | "deleted_at" | "text_crdt",
  "value": { "...": "..." },
  "lamportTs": 0,
  "clientId": "string"
}
```

## メッセージ形式（サーバー→送信元、重複op）

Railsが「既に記録済みのop（ack再送など）」と判定した場合、他クライアントへはブロードキャスト・Redis中継のいずれも行わない（`text_crdt`は差分適用のため、二重配信すると受信側で二重適用されてしまう）。送信元へは確定済みの`value`（`text_crdt`ならrevision込み）とともにackのみ返し、接続は維持される。

```json
{
  "objectId": "string",
  "property": "string",
  "value": { "...": "..." },
  "lamportTs": 0,
  "clientId": "string",
  "duplicate": true
}
```

既知の限界: Rails保存成功後・このackのbroadcast/relay実行前にsync-serverプロセスが停止した場合、そのopは元の送信元以外には配信されない（durable outboxのような永続的な再配信保証は現状未実装、早期開発段階のトレードオフとして許容）。

## メッセージ形式（サーバー→送信元、再同期要求）

`text_crdt`のOTに必要な`ref_revision`が省略・不正（存在しない/古すぎる）だった場合、Railsは`409 { resyncRequired: true }`を返す。sync-serverはこれを他クライアントへ配信せず、送信元にのみ再同期を促す通知を返す。接続は維持される。

```json
{
  "objectId": "string",
  "error": "operation rejected: resync required before retrying",
  "resyncRequired": true
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

## `presence`（カーソル位置などのephemeralな状態）

他のプロパティと異なり、Rails（`object_ops`）へは一切永続化されない。同一board内の接続へ`hub.Broadcast`とRedis中継のみ行う一時的な状態共有。

- `value`は`{ "cursor": { "x": number, "y": number } }`のみを許可し、512バイトを超える値・余分なキーは拒否（接続を`ClosePolicyViolation`でクローズ）
- 送信元単位で同一board内、30Hz（約33ms間隔）を超えるブロードキャストは間引かれる（黙って破棄、接続は維持）
- 別途トークンバケット方式のレート制限（`internal/ws/limiter.go`）があり、board+ユーザー単位でイベント数（平均40/秒・バースト60）とバイト数（平均10KB/秒・バースト20KB）を課金する。課金対象は受信メッセージ全体のバイト数（`objectId`/`clientId`を含む）であり、`value`のバイト数だけではない

## 接続クローズの扱い

- 同一lamport_ts以下の古いop（`ErrStaleOp`）: ブロードキャストせず`continue`。接続は維持
- 送信キューが溢れている遅いクライアント: 該当クライアントの接続を`ClosePolicyViolation`でクローズ（黙って通知を破棄しない）
- サポート対象外の`property`のop: `CloseUnsupportedData`でクローズ
- 必須フィールドの欠落、`boardId`不一致、`objectId`/`clientId`の長さ超過、`presence`値の形式不正: `ClosePolicyViolation`でクローズ

## Redis中継

複数の sync-server ノード間でopを配信するため、Redis pub/subを使用する（`internal/ws/relay_redis.go`）。チャネル接頭辞・プールサイズは環境変数で設定する（`SYNC_SERVER_REDIS_URL` 等。`CLAUDE.md`の開発コマンド節、`src/backend/.env.example`参照）。
