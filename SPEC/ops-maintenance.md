# 保守運用 Runbook

実装済みの監視エンドポイント・データ保持設計のみを記載する。外形監視・アラート・自動バッチ等の運用フローは未実装のため `TASKS/` を参照（issue #23）。

## 監視エンドポイント（実装済み）

- Rails `/healthz`: ヘルスチェックエンドポイント（`health#show`）
- Gin `/healthz`: ヘルスチェックエンドポイント
- Gin `/metrics`: Prometheus 形式でメトリクスを公開する（`sync_server_websocket_connections`、`sync_server_sync_operation_duration_seconds` 等。`src/sync-server/internal/ws/metrics.go`）
- Rails / Next.js の未捕捉例外は Sentry と連携している（`SENTRY_DSN` 設定時）。`POST /client_errors` は Sentry 未設定時のみの補助経路として実装されている

## tombstone 保持期間（実装済み）

- `BoardObject::TOMBSTONE_RETENTION = 30.days`（`src/backend/app/models/board_object.rb`）
- `purgeable_tombstones` スコープで30日を超えた tombstone を抽出できる（バッチ実行の仕組み自体は未実装。下記「未実施」参照）

## 未実施（TASKS で管理）

以下は本リポジトリのコードとしては存在せず、実装済みとして扱ってはならない。デプロイフェーズ以降の対応として `TASKS/` に記載する。

- 外形監視（UptimeRobot 等）のポーリング設定、Prometheus アラートルール、ページング/Slack 通知連携（issue #23）
- 上記アラートの整備を前提とした週次パッチ運用フロー・監視ダッシュボード観測手順
- `purgeable_tombstones` を実行する rake タスク／ジョブ／スケジューラ（クエリのみ実装済みで、定期実行の仕組みは無い）
