# 保守運用 Runbook

実装・設定済みの運用のみを記載する。未対応のものは末尾の「未実施」節に分けて書く（issue #23）。

## 監視エンドポイント（実装済み）

- Rails `/healthz`: ヘルスチェックエンドポイント（`health#show`）
- Gin `/healthz`: ヘルスチェックエンドポイント
- Gin `/metrics`: Prometheus 形式でメトリクスを公開する（`sync_server_websocket_connections`、`sync_server_sync_operation_duration_seconds` 等。`src/sync-server/internal/ws/metrics.go`）
  - **`SYNC_SERVER_METRICS_TOKEN` が必須（Bearer 認証）**。scrape 側は `Authorization: Bearer <token>` を付ける。本番では未設定だと sync-server が起動しない（issue #229）
  - `/healthz` は外形監視から叩くため認証なしのまま
- Rails / Next.js の未捕捉例外は Sentry と連携している（`SENTRY_DSN` 設定時）。`POST /client_errors` は Sentry 未設定時のみの補助経路として実装されている

## 死活監視・障害通知（設定済み）

- Railway の `backend` / `sync-server` に healthcheck パス `/healthz` を設定済み。デプロイ時にヘルスチェックが通らなければ切り替えを中止する
- Railway の Webhook で Deployment Failed / Crashed を Slack に通知する。Webhook URL は Railway 側にのみ保持し、リポジトリには置かない

## tombstone 保持期間（実装済み）

- `BoardObject::TOMBSTONE_RETENTION = 30.days`（`src/backend/app/models/board_object.rb`）
- `purgeable_tombstones` スコープで30日を超えた tombstone を抽出できる

### パージバッチ（実装済み）

`BoardObjects::TombstonePurger`（`src/backend/app/services/board_objects/tombstone_purger.rb`）が
対象 tombstone とその従属レコード（`object_ops` / `comments` / `frame_locks`）を削除する。
子オブジェクトから参照されているフレームは削除せず skip する。

手動実行：

```bash
bundle exec rails board_objects:purge_tombstones            # 実削除
DRY_RUN=true bundle exec rails board_objects:purge_tombstones  # 件数のみ出力
```

**定期実行は Railway Cron で設定済み**（2026-08-20・issue #227）。`questboard` プロジェクト内の
`tombstone-purge` サービスが日次 03:00 JST（cron `0 18 * * *`）に上記コマンドを実行する。

- 環境変数は backend への参照（`$` + `{{backend.VAR}}` 形式）で渡しており、秘密情報の値を二重に持たない
- **Railway の cron は実行ごとに新しいデプロイを作らない。** 同一デプロイのコンテナを起動し直すため、
  実行履歴は Deployments ではなくサービスのログで確認する（`[purge_tombstones] purged=N skipped=N`）
- 対象が 0 件でも毎日起動する。ログに行が出ていなければスケジューラ自体を疑う

## 閾値チェック（実装済み）

`scripts/check-sync-metrics.mjs` が本番の `/metrics` を取得し、閾値を超えていれば非ゼロ終了する。
CI の `Security / Sync metrics threshold` ジョブが日次 cron（06:00 JST）と手動実行で走らせる。

| 系列 | 既定の閾値 | 意図 |
|---|---|---|
| `sync_server_websocket_connections` | 500 超で失敗 | 切断漏れで接続が積み上がる異常 |
| `sync_server_slow_client_drops_total` | 20 件超で失敗 | 配信が詰まって遅いクライアントを切り続けている |
| `sync_server_sync_operation_duration_seconds` | 1秒超が 1% を上回ると失敗 | 同期処理の劣化 |

- 標本が 20 件未満のときは比率を判定しない。起動直後の数件で毎回鳴ると、アラート自体が無視されるようになる
- 系列そのものが消えていた場合も失敗させる。エンドポイントが 200 でも中身が変わったことに気づけないため
- 通知経路は現状 GitHub Actions の失敗通知のみ。Slack への集約は未実施（下記参照）
- 閾値を変えたら `workflow_dispatch` で即座に流して確認する。翌朝の cron を待たない

手動実行（ローカル）:

```bash
SYNC_METRICS_URL=https://sync.questboard.rictaworks.jp/metrics \
SYNC_SERVER_METRICS_TOKEN=<token> node scripts/check-sync-metrics.mjs
```

## 未実施（TASKS で管理）

以下は本リポジトリのコードとしては存在せず、実装済みとして扱ってはならない。デプロイフェーズ以降の対応として `TASKS/` に記載する。

- 外形監視（UptimeRobot 等）の外部サービスからのポーリング設定（issue #23）
- 閾値超過の Slack 通知。現状は GitHub Actions の失敗通知に依存しており、Railway のデプロイ失敗通知と経路が分かれている（issue #23）
- 分単位の粒度でのメトリクス監視。日次スナップショットのため、日中に発生して回復した劣化は取りこぼす（issue #23）
- 上記アラートの整備を前提とした週次パッチ運用フロー・監視ダッシュボード観測手順
