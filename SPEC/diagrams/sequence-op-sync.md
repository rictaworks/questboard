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
