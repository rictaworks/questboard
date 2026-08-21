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
- **backend には `PORT=80` を明示的に設定してある。消さないこと**（issue #232）
  - Railway はコンテナに `PORT=8080` を注入し、**healthcheck はその `PORT` を叩く**
  - backend の起動は `./bin/thrust ./bin/rails server`。Thruster は自身の待受に `HTTP_PORT`（既定 80）を使い、`PORT` は Puma 用に `TARGET_PORT`（既定 3000）として渡すだけなので、**8080 は誰も listen しない**
  - 公開トラフィックはドメインの targetPort=80 経由なので正常に見え、**healthcheck だけが落ちる**。この状態で 11 回連続でデプロイが失敗した
  - sync-server は Go 側が `PORT` をそのまま使うため、この問題は起きない

- Railway の Webhook で Deployment Failed / Crashed を Slack に通知する。Webhook URL は Railway 側にのみ保持し、リポジトリには置かない

コンテナ内から確認する場合（Railway のサービス → Console）:

```bash
env | grep -E '^(PORT|HTTP_PORT|TARGET_PORT)='
awk 'NR>1 && $4=="0A" {print $2}' /proc/net/tcp6   # 0050=80, 1F90=8080
curl -sS -o /dev/null -w '%{http_code}\n' "http://[::1]:${PORT}/healthz"
```

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
- 閾値を超えると `SLACK_WEBHOOK_URL`（GitHub Actions Secrets）宛に Slack 通知を送る。Railway のデプロイ失敗通知と同じチャンネルに寄せている
  - **Secret が未登録の間は通知ステップが何もせず終了する。** ジョブの失敗自体は残るので、気づけないわけではないが Slack には出ない
- 閾値を変えたら `workflow_dispatch` で即座に流して確認する。翌朝の cron を待たない
- **通知経路そのものを試験できる。** `workflow_dispatch` の `alert_drill` を true にすると、
  閾値を超えていなくてもジョブを失敗させて Slack 通知を発火させる

```bash
gh workflow run ci.yml --repo rictaworks/questboard --ref main -f alert_drill=true
```

  監視は設定しただけでは動いている保証にならない。通知先を変えたときは必ずこれで発火を確かめる
  （backend の healthcheck を設定しただけで確認せず、11 回連続でデプロイを落とした前例がある。issue #232）

手動実行（ローカル）:

```bash
SYNC_METRICS_URL=https://sync.questboard.rictaworks.jp/metrics \
SYNC_SERVER_METRICS_TOKEN=<token> node scripts/check-sync-metrics.mjs
```

## 外形監視（設定済み）

UptimeRobot（無料枠）から 5 分間隔でポーリングし、失敗時はアカウントのメールに通知する。

| 監視 | URL | 種別 |
|---|---|---|
| トップページ | `https://questboard.rictaworks.jp` | HTTP(s) |
| backend | `https://api.questboard.rictaworks.jp/healthz` | Keyword `"status":"ok"` |
| sync-server | `https://sync.questboard.rictaworks.jp/healthz` | Keyword `"status":"ok"` |

- キーワード条件は「**存在しなければ障害**」。200 を返しつつ中身が変わった場合に HTTP 監視では気づけないため
- `/metrics` は監視対象に入れない。Bearer 認証が必要で、認証なしのポーリングは 401 になり鳴り続ける
- 設定手順と、無料プランでは API から監視を作れない件は `20_開発/questboard-monitoring/README.md`（このリポジトリ外）

**外形監視だけは自前インフラの外に置く。** 本体が落ちたときに一緒に落ちる場所へ監視を置くと、「アラートが来ない」と「正常」が区別できなくなる。

## 週次パッチ運用

依存更新は **Dependabot が PR を作り、osv-scanner が検知する**。人が毎週見るのは Dependabot の PR だけでよい。

### 自動で動くもの

| 仕組み | 頻度 | 役割 |
|---|---|---|
| Dependabot（npm / bundler / gomod） | 毎週月曜 06:00 JST | 更新 PR の作成 |
| Dependabot（github-actions） | 月次 | CI で使う action の更新（サプライチェーンの一部） |
| CI `Security / Dependency scan`（osv-scanner） | 日次 06:00 JST ＋ 全 PR | 脆弱性の検知 |
| CI `Backend / Brakeman` | 全 PR | Rails の静的セキュリティ検査 |

- 通常の minor / patch はグループ化されて 1 本の PR にまとまる。個別 PR が乱立すると確認しきれないため
- **公開から 7 日は更新 PR を作らない**（`cooldown`）。公開直後の版には、取り込み後に問題が判明するものが混じりうるため。ただし **cooldown はセキュリティ更新には適用されない**ので、脆弱性の修正が待たされることはない
- **セキュリティ更新は `open-pull-requests-limit` と無関係に別 PR で来る**。上限に達していても止まらない

**ワークフローが参照する action は 40 桁のコミット SHA で固定している**（issue #241）。タグやブランチは提供者が後から差し替えられるためで、実際に他社の action が乗っ取られた事例がある。CI は Railway / Vercel / Slack の資格情報を持つので、差し替えられると到達される。

- 版は `# v7.0.1` のようにコメントで併記する。SHA だけでは何を使っているか読めない
- `ruby/setup-ruby@v1` は**タグではなくブランチ**だった。固定前はいつ動いてもおかしくなかった
- 更新は Dependabot（`github-actions`・月次）が SHA ごと PR に上げる。**固定したまま更新が回る**

### 毎週やること

1. Dependabot の PR を見る。CI が緑なら順にマージする
2. `Security / Dependency scan` が赤い週は、Dependabot の PR だけでは解決していない。下記「Dependabot で閉じない場合」へ
3. マージしただけでは本番に出ない。**反映は Release の発行**（`release-deploy.yml` が Railway → Vercel の順にデプロイする）

### Dependabot で閉じない場合

- **推移的依存**は Dependabot が直接上げられないことがある。親の依存を上げて解消する（例：gin と quic-go を同時に更新した PR #223）
- **Go の stdlib** は `go.mod` の `go` ディレクティブが要求バージョンとして照合される。宣言が古いままだと、修正済みの stdlib 脆弱性を抱えた状態として検出され続ける

### 週次で見る場所

| 見るもの | どこ |
|---|---|
| デプロイ失敗・クラッシュ | Slack `#questboard-alerts`（Railway Webhook） |
| 全 Railway プロジェクトの健全性 | 同上（この端末の日次横断点検） |
| 外形監視の障害 | UptimeRobot からのメール |
| `/metrics` の閾値超過 | Slack `#questboard-alerts`（日次 CI） |
| 利用状況・KPI | `/admin` の KPI ダッシュボード |

通知が来ていなければ健全、という前提で運用する。**そのため通知経路が生きていること自体を定期的に確かめる**（`alert_drill` と横断点検の `--drill`）。設定しただけの監視は動いている保証にならない。

## 版数の扱い

**版数の正はリリースタグ（`vX.Y.Z`）。`package.json` に `version` は置かない**（issue #244）。

- このリポジトリは `private: true` でパッケージとして公開しないため、`version` は誰にも読まれない
- 置いておくと必ずタグとずれる。実際に `1.0.0` のまま残り、タグが v1.0.3 まで進んでも更新されていなかった
- `test/scaffold.test.mjs` が `version` の不在を検査する。同期する運用へ戻すなら、そのテストを消したうえでタグ発行手順に同期を組み込む

なお**版数の刻み方（どの変更でどの桁を上げるか）の規則は未整備**。監査ではこの不在により版数の妥当性が判定不能になる。

## 未実施（TASKS で管理）

以下は本リポジトリのコードとしては存在せず、実装済みとして扱ってはならない。

- 分単位の粒度でのメトリクス監視。日次スナップショットのため、日中に発生して回復した劣化は取りこぼす（issue #23）
  - 実現には Grafana Cloud 等への remote-write と、Railway への収集エージェント追加が要る。取りこぼしが実際に問題になってから判断する
