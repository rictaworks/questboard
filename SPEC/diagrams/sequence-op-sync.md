# シーケンス図（op同期フロー）

`/ws` 経由でクライアントがopを送信してから、他クライアントへブロードキャストされるまでの実装済みフロー。実装は `src/sync-server/internal/ws/handler.go`、`src/backend/app/controllers/objects_controller.rb`。

## 通常の確定op

```mermaid
sequenceDiagram
    participant C1 as クライアントA
    participant SS as sync-server (Go)
    participant Rails as Rails backend
    participant C2 as クライアントB(同一board)

    C1->>SS: op送信 (property, value, lamport_ts, clientId)
    SS->>SS: Origin検証・認可チェック
    SS->>Rails: POST /boards/:token/objects/:id/ops
    Rails->>Rails: object.with_lock内でLamport順序を検証・記録
    Rails-->>SS: 200 + 確定op(実際に永続化された値)
    SS-->>C1: 確定opをブロードキャスト
    SS-->>C2: 確定opをブロードキャスト
```

## 削除済みオブジェクトへの編集（tombstone競合）

```mermaid
sequenceDiagram
    participant C1 as クライアントA
    participant SS as sync-server (Go)
    participant Rails as Rails backend
    participant C2 as クライアントB(同一board)

    C1->>SS: geometry/color op送信(対象は削除済み)
    SS->>Rails: POST /boards/:token/objects/:id/ops
    Rails->>Rails: with_lock内でdeleted_atを再検証
    Rails-->>SS: 409 { error, restoreSuggested: true }
    SS-->>C1: 復元提案メッセージ(objectId, error, restoreSuggested)
    Note over C2: ブロードキャストなし。C1の接続は維持される
```

## 送信キュー溢れ時の切断

```mermaid
sequenceDiagram
    participant C as 低速クライアント
    participant SS as sync-server (Go)

    Note over SS: C宛ての送信バッファが上限(32)に到達
    SS->>SS: 通知payloadの非ブロッキング送信が失敗
    SS-->>C: ClosePolicyViolationで接続をクローズ(黙って破棄しない)
```

## `text_crdt`のOT変換を伴う確定op

クライアントAが観測後のrevisionを基準（`ref_revision`）に差分を送るが、それより後にクライアントBの編集が確定済みの場合。実装は `ObjectsController#transform_text_crdt_ops`, `TextOT.transform`。

```mermaid
sequenceDiagram
    participant C1 as クライアントA
    participant SS as sync-server (Go)
    participant Rails as Rails backend
    participant C2 as クライアントB(同一board)

    Note over C1: 直前に観測したrevision(例: 42)を保持
    C1->>SS: text_crdt op送信 (ops, ref_revision: 42, lamport_ts, clientId)
    SS->>Rails: POST /boards/:token/objects/:id/ops
    Rails->>Rails: id > 42 の確定済みopをOT変換してから合成(compose_text_crdt_ops)
    Rails->>Rails: objects.text_crdt(Delta形式)・text_crdt_revisionを同一トランザクションで更新
    Rails-->>SS: 200 + 確定op(変換後ops, revision, duplicate:false)
    SS-->>C1: 確定opをブロードキャスト
    SS-->>C2: 確定opをブロードキャスト
```

## `ref_revision`不正・履歴超過による再同期要求

```mermaid
sequenceDiagram
    participant C1 as クライアントA
    participant SS as sync-server (Go)
    participant Rails as Rails backend
    participant C2 as クライアントB(同一board)

    C1->>SS: text_crdt op送信(ref_revisionが省略/不正/古すぎる)
    SS->>Rails: POST /boards/:token/objects/:id/ops
    Rails-->>SS: 409 { error, resyncRequired: true }
    SS-->>C1: 再同期要求メッセージ(objectId, error, resyncRequired)
    Note over C2: ブロードキャストなし。C1の接続は維持される
    Note over C1: GET /boards/:share_token で最新textCrdt/textCrdtRevisionを取得し直す
```

## 重複op(ack再送)

ACK消失などで同じ`clientId`/`lamport_ts`のopが再送された場合。他クライアントは初回確定時に既に反映済みのため、再ブロードキャストしない。

```mermaid
sequenceDiagram
    participant C1 as クライアントA
    participant SS as sync-server (Go)
    participant Rails as Rails backend
    participant C2 as クライアントB(同一board)

    C1->>SS: 同一clientId/lamport_ts/opsのop送信(再送)
    SS->>Rails: POST /boards/:token/objects/:id/ops
    Rails-->>SS: 200 + 確定op(既存レコードそのまま, duplicate:true)
    Note over C2: ブロードキャスト・Redis中継なし
    SS-->>C1: 確定済みvalue/revision込みのackのみ返す
```

## `presence`（カーソル位置）のブロードキャスト

Railsへは永続化せず、sync-server内で完結する。実装は `internal/ws/handler.go`, `internal/ws/limiter.go`。

```mermaid
sequenceDiagram
    participant C1 as クライアントA
    participant SS as sync-server (Go)
    participant C2 as クライアントB(同一board)

    C1->>SS: presence op送信 (cursor: {x, y})
    SS->>SS: value形式検証・レート制限(RateLimiter)・30Hzスロットリング判定
    alt レート超過 or スロットリング間隔未満
        SS->>SS: 黙って破棄(continue、接続維持)
    else 許可
        SS-->>C1: presence opをブロードキャスト
        SS-->>C2: presence opをブロードキャスト
        Note over SS: Rails(object_ops)への永続化は行わない
    end
```
