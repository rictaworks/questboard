# Claude Safety Rules

## 削除系コマンドの禁止（重要）

以下のルールはこのワークスペース内のすべての会話で絶対に守られる：

- Claude はファイルまたはディレクトリを削除するコマンドを一切生成してはならない。
  例：rm, rm -rf, rm *, rmdir, unlink, cache --delete,
      lftp mirror --delete, rsync --delete, git clean -df, find -delete 等。

- 削除が必要な場合でも、Claude は削除コマンドを提案せず、
  「手動で削除してください」といった説明に留めること。

- 削除の推奨・削除操作の自動判断も禁止。

- ssh / lftp / デプロイ系スクリプトを生成する場合でも、
  削除コマンドの生成は禁止。

これらはすべての会話・コード生成に適用される。

## シークレット管理（重要）

- `config/master.key` など機密ファイルを `git add` するコードを生成してはならない
- デプロイスクリプト・セットアップ手順でも同様
- シークレットは必ず環境変数（RAILS_MASTER_KEY 等）で渡すこと
- `.gitignore` への追加を確認する手順を必ずコードに含めること
- 初回コミット前に `git status` でステージング確認を促すこと

---

# 開発プロセス

## AI役割分担

1次実装はGithub Copilot、セキュリティレビューはCodexが担当する。

| フェーズ | 担当モデル |
|---|---|
| 設計 | Claude Opus |
| Issue 発行 | Claude Sonnet |
| 1次実装 | GitHub Copilot GPT5.4mini |
| セキュリティレビュー | Codex GPT5.6sol |
| 修正 | Antigravity 3.5 Flash |
| コードレビュー | Claude Sonnet |
| テスト作成・実行 | Claude Sonnet |

### リリースフロー

1. 各 Issue を上記役割分担で実装・レビュー・マージする
2. **全 Issue 完了後**に人力コードレビューを実施する
3. **全 Issue 完了後**にユーザーテスト（実機確認）を実施する

## サブエージェント構成

規模に応じて、以下のエージェントを作成すること：
`director`, `project-manager`, `designer`, `debugger`, `tester`, `data-scientist`, `deployer`, `writer`, `service-manager`

### サブエージェント個別指示

- **pr-checker**：レビューは行わない。全PRを日本語で記載し、非エンジニア向けのユーザーテスト手順をPR本文に丁寧に書くこと。
- **tester**：全PR対象に、PRに書かれたユーザーテスト手順の実行スクリプトを作成する（RSPEC, Jest等）。`TM.md` に記載されたテストも作成する。テストは `test/pr***/` 配下に作成し、テスト対象は開発サーバーとする。

## ブランチ運用

- `main` ブランチでの直接作業は禁止する
- `src/*` 以外は `main` ブランチへのpushを許可する
- `src/*` の変更は必ずPRを作成すること

## ドキュメント・ディレクトリ運用

- `README.md` に自動ログイン手順・ページ一覧（ページ名・URL）・API一覧（SPEC/apiへのリンク、タイトル・エンドポイントURL）をもれなく記載する
- `README.md` と `SPEC/` には実装済みの機能・画面・APIのみを記載する。未実装・計画中の内容は書かない（構想段階のものは `TASKS/` に記載する）
- `TASKS/`：タスク管理
- `DEBUG/`：バグ報告
- `CLIENT/`：クライアント要望等
- `WORK/`：作業報告
- `ENV/DEVELOPMENT.md`：開発環境
- `ENV/PRODUCTION.md`：本番環境
- `SPEC/`：仕様書、リバースエンジニアリング図（ER図・DFD・シーケンス図・クラス図・状態遷移図・ユースケース図）。図解はMermaidを使用する
- `DELETE/`：ゴミ箱として運用する（Claudeはこのディレクトリへの削除系操作も含め、削除コマンドを直接実行しない。本ファイル冒頭の「削除系コマンドの禁止」参照）
- 事前にデザイン指定がある場合は `app-ui/` に配置されたモックに従うこと

## PR規約

- PRには非エンジニア向けのユーザーテスト手順を丁寧に書くこと

## 開発コマンド

モノレポ構成（フロント `/`、Rails `src/backend/`、Go sync-server `src/sync-server/`）。`.github/workflows/ci.yml` が実行内容の正:

- フロントエンド lint: `npm run lint`
- フロントエンド build/test: `npm run build && node --test test/*.test.mjs`
- Backend RSpec: `cd src/backend && bundle exec rspec`（Ruby 3.4.10必須。無い場合はローカル実行できずCI待ちになる）
- Backend RuboCop: `cd src/backend && bundle exec rubocop`
- Backend Brakeman: `cd src/backend && bundle exec brakeman --no-pager`
- Go test: `go test ./tools/... ./src/sync-server/...`（`go.work` がrootモジュールと`src/sync-server`を束ねる別モジュール構成）
- Go lint: `golangci-lint run ./...`（設定は `.golangci.yml`）

## コーディング規約

- **TDD厳守**：plan → red test → coding → green test。RSPEC, Jest等を使用する
- フロントエンドの確認は curl, `wget --mirror`, Playwright で行うこと
- デフォルトアイコンは FontAwesome を使用する。絵文字は禁止
- 環境変数は `.env` を参照すること
- コミット前に `QC10`, `TM`, `QA`（OWASP Top 10）の各ファイルを参照してセキュリティレビューを行うこと
- 時刻はJST、エンコードはUTF-8を使用する
- フォールバック処理は禁止。例外処理をしっかり書くこと
- デバッグトレースできるようにコードを書くこと
- 制御構文・条件構文以外はクラスまたは関数に書くこと。セキュリティの観点からグローバル変数を禁止する
- 文字列リテラルは設定ファイル（またはDB）に分離すること。ハードコードをチェックするテストを書くこと
- ネイティブの `alert()` / `confirm()` / `prompt()` はプロジェクト全体で使用禁止とする
- 環境判定を必ず実装し、環境ごとに分岐できるようにすること。テスト可能にするため、開発環境は認証済みとして分岐すること

## CI/CD

- CI/CDは必須
- CDはClaude Desktopで設定する
- Webの場合、デプロイから先の作業はClaude Desktopで行う。デスクトップ/スマホの場合はビルドから先、ESP32の場合は焼き込みから先をClaude Desktopで行う
- Webのデプロイはヘッドレスで実行する。バックエンドのドメインは隠蔽する

---

# 自社開発プロジェクトの方針（questboard含む）

- 画像はAI生成すること。プロのライティングはライターエージェントに行わせること
- 規模に応じて、マイクロサービスアーキテクチャ、MVCアーキテクチャ、API Gateway、メッセージングを意識すること
- メンテナンスコストとセキュリティの観点から、安全なライブラリ・フレームワーク・OSS・SaaSを適用し、車輪の再発明を避けてオリジナルコードを少なく保つこと
- 技術スタックはNext + Rails + PostgreSQLを基本とする。必要に応じて、AI・解析・画像加工はFastAPI、高速並列処理・リアルタイム通信はGinでAPIを作ってよい
- デプロイ先は原則、フロントは無料Vercel、バックエンドと管理画面は無料Railway（またはRender）とする
- 認証はGoogleログインとする。一般消費者が実際に使える手段でログインできること（開発者向けの近道を本番UIに露出しない）
- ドメインは原則 `rictaworks.jp` のサブドメインとする
- 当初から多言語で開発すること：日本語・英語・フランス語・中国語・ロシア語・スペイン語・アラビア語。ただし開発者用管理画面は日本語のみ