# 保守運用 Runbook

## 監視

- Rails `/healthz`: 外形監視でポーリングする
- Gin `/healthz`: 外形監視でポーリングする
- Gin `/metrics`: Prometheus で収集する

### 代表アラート

- `/healthz` が 3 回連続で失敗したらページング通知
- `sync_server_websocket_connections` が通常値から急増/急減したら通知
- `histogram_quantile(0.95, rate(sync_server_sync_operation_duration_seconds_bucket[5m])) > 0.25` を 10 分継続したら通知

通知先は `#questboard-ops` とオンコール通知チャネルを併用する。

## 週次パッチ運用

1. 依存関係の更新候補を確認する
2. Rails / Next / Gin のテストを個別実行する
3. 本番相当環境へ段階的に反映する
4. 監視ダッシュボードで `/healthz` と `/metrics` を 30 分観測する

### 例外時の扱い

- 失敗したパッチはロールバックする
- 例外はフロントエンド/バックエンド双方のエラートラッキングへ送る

## tombstone 30日物理削除バッチ

- 30日を超えた tombstone の物理削除責任はバックエンド担当が持つ
- スケジューリングと失敗通知は運用担当が持つ
- 実行前に件数確認、実行後に削除件数と残件数を記録する

