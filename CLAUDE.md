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

## AI分担

設計から実装・レビュー・テストまで Claude（Claude Code）が一貫して担当する（2026-08-19 更新。モデルは変わるので担当モデル名は参考値）。

### AI 役割分担

| フェーズ | 担当 |
|---|---|
| 設計 | Claude（参考: Fable 5） |
| Issue 発行 | Claude（参考: Fable 5） |
| 実装 | Claude（参考: Fable 5） |
| セキュリティレビュー | Claude（参考: Fable 5） |
| 修正 | Claude（参考: Fable 5） |
| コードレビュー(reviewer) | Claude（参考: Fable 5） |
| テスト作成・実行 | Claude（参考: Fable 5） |
| ユーザーテスト | **AI が開発環境・本番環境でそれぞれ実施**（ブラウザツールで実操作） |
| 本番での動作確認・評価 | **人間**（人力はこれのみ） |

PRに投稿するときはフッターにモデル名を記載すること。

### リリースフロー

1. 各 Issue を AI が実装・レビュー・マージする（ユーザーテストは開発環境で AI がその都度実施）
2. リリース（本番デプロイ）後に AI が**本番環境でもユーザーテスト**を実施する
3. 人間は**本番環境での動作確認と評価のみ**行う
4. **リリース後**に code-review スキルを実施する

## サブエージェント

実在するのは `.claude/agents/` の2つのみ。必要に応じて追加する。

- **pr-checker**：レビューは行わない。PRのタイトル・本文の日本語化と、非エンジニア向けユーザーテスト手順のPR本文への追記のみを行う（`e2e/pr***.md`は作成しない）
- **reviewer**：issueの受け入れ要件と各規約ドキュメントへの適合を検証する。バグ・重複の指摘は `/code-review` の担当で、混同しない

## ブランチ運用

- **すべての変更は PR 経由で `main` へ入れる。直接 push はブランチ保護が拒否する**（2026-08-21 設定・issue #243）
  - PR 必須（承認 0 件・1 人運用のため）・必須ステータスチェック 8 件・管理者もバイパス不可・force push と削除は禁止
  - 実際に直接 push が `protected branch hook declined` で拒否されることを確認済み
  - 以前は「`src/*` 以外は直接 push 可」だったが、保護はパスを区別できないため全 push が対象になった。ドキュメントだけの変更も PR を作る
  - 緊急でどうしても直接 push が要る場合は、Settings → Branches で保護を一時的に外し、済んだら必ず戻す

## ドキュメント・ディレクトリ運用

- `README.md` に自動ログイン手順・ページ一覧（ページ名・URL）・API一覧（SPEC/apiへのリンク、タイトル・エンドポイントURL）をもれなく記載する
- `README.md` と `SPEC/` には実装済みの機能・画面・APIのみを記載する。未実装・計画中の内容は書かない（構想段階のものは `TASKS/` に記載する）
- `TASKS/`：タスク管理
- `DEBUG/`：バグ報告
- `CLIENT/`：クライアント要望等
- `WORK/`：作業報告
- `ENV/`：環境情報（`DEVELOPMENT.md` / `PRODUCTION.md` は未作成）
- `SPEC/`：仕様書、リバースエンジニアリング図（ER図・DFD・シーケンス図・クラス図・状態遷移図・ユースケース図）。図解はMermaidを使用する
- `DELETE/`：ゴミ箱として運用する（Claudeはこのディレクトリへの削除系操作も含め、削除コマンドを直接実行しない。本ファイル冒頭の「削除系コマンドの禁止」参照）
- 事前にデザイン指定がある場合は `app-ui/` に配置されたモックに従うこと
- `TASKS/` `DEBUG/` `CLIENT/` `WORK/` `ENV/` `DELETE/` `app-ui/` `.claude/` `AGENTS.md` `TM.md` `QA.md` は `.gitignore` 除外で、cloneしたツリーには無い（追跡されるドキュメントは `SPEC/` `README.md` `CLAUDE.md` 等）

## PR規約

- PRには非エンジニア向けのユーザーテスト手順を丁寧に書くこと（PR本文に記載するのみとし、`e2e/pr***.md` への複製は行わない）

## 開発コマンド

モノレポ構成（フロント `/`、Rails `src/backend/`、Go sync-server `src/sync-server/`）。`.github/workflows/ci.yml` が実行内容の正:

- フロントエンド lint: `npm run lint`
- フロントエンド build/test: `npm run build && node --test test/*.test.mjs`
- `npm test` は `test:go` → `build` → `node --test` の順に走る（lintは含まない）
- Backend RSpec: `cd src/backend && bundle exec rspec`（Ruby 3.4.10必須。**先に `docker compose up -d postgres` が要る**。DBが起動していないとローカル実行できずCI待ちになる）
- DBは開発・テスト・本番すべてPostgreSQL。Gemfileと `src/backend/Dockerfile` に残る `sqlite3` はSQLite時代の残骸
- Backend RuboCop: `cd src/backend && bundle exec rubocop`
- Backend Brakeman: `cd src/backend && bundle exec brakeman --no-pager`
- Go test: `go test ./tools/... ./src/sync-server/...`（`go.work` がrootモジュールと`src/sync-server`を束ねる別モジュール構成）
- Go lint: `golangci-lint run ./...`（設定は `.golangci.yml`。CIは golangci-lint v2.11.3 固定）

## コーディング規約

- **TDD厳守**：plan → red test → coding → green test。RSPEC, Jest等を使用する
- フロントエンドの確認は curl, `wget --mirror`, Playwright で行うこと
- デフォルトアイコンは FontAwesome を使用する。絵文字は禁止
- 環境変数は `.env` を参照すること
- コミット前にセキュリティレビューを行う。参照先は `.claude/QC10.md`・`.claude/OWASP10.md`・`.claude/CC.md`・`TM.md`・`QA.md`・`CRAP.md`・`development-principles.md`
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
- デプロイから先の作業はClaude Desktopで行う
- Webのデプロイはヘッドレスで実行する。バックエンドのドメインは隠蔽する

---

# 自社開発プロジェクトの方針（questboard含む）

- 画像はAI生成すること。プロのライティングはライターエージェントに行わせること
- メンテナンスコストとセキュリティの観点から、安全なライブラリ・フレームワーク・OSS・SaaSを適用し、車輪の再発明を避けてオリジナルコードを少なく保つこと
- 技術スタックはNext + Rails + PostgreSQLを基本とする。必要に応じて、AI・解析・画像加工はFastAPI、高速並列処理・リアルタイム通信はGinでAPIを作ってよい
- デプロイ先は原則、フロントは無料Vercel、バックエンドと管理画面は無料Railwayとする
  - デプロイ設定は未作成（`vercel.json` / `railway.toml` / `render.yaml` いずれも無し。`.github/workflows/` は `ci.yml` のみでCDは無い）
- 認証は、MVPはXログイン、製品版はXログイン（`@rictaworks` フォロワーのみログイン可）とする
  - 現在の実装はXログインのみ。フォロワー判定は未実装（要望は `CLIENT/` の製品版仕様書）
  - 一般消費者が実際に使える手段でログインできること（開発者向けの近道を本番UIに露出しない）
- ドメインは原則 `rictaworks.jp` のサブドメインとする
- 表示言語は日本語のみとする。多言語対応は行わない
  - 海外クライアントが存在せず、多言語対応が生む利益が無いため（2026-08-08 決定）
  - ロケールを URL 接頭辞に持たせる構成（`src/app/[locale]/`）は復活させない。`[locale]` は1セグメントのパスなら何にでも一致するため、`/robots.txt` や `/wp-login.php` までルートとして受けてしまい、それを打ち消すためにミドルウェアでのロケール解決・実ファイルの素通し判定・専用の 404 シェルが芋づる式に必要になる
  - ロケール解決のためのミドルウェア（`src/middleware.ts`）は置かない
  - 上記2点は `test/scaffold.test.mjs` の「locale routing is not reintroduced」で検査する
- next-intl は翻訳のためではなく、メッセージカタログとして残す
  - 「文字列リテラルは設定ファイルに分離すること」（コーディング規約）を満たすため。日本語をコンポーネントに直書きしてはならない
  - ICU の補間・複数形も利用しているため、自前実装への置き換えは「車輪の再発明を避ける」方針に反する
  - メッセージファイルは `src/messages/ja.json` の1つだけ。増やす場合は本方針の変更を伴う