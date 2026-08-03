# E2E ユーザーテスト手順一覧

questboard の全マージ済みPRのユーザーテスト手順をPR本文から抽出し、PR番号順に集約したもの。各ファイルの内容は該当PR本文からの転記（要約・改変なし）。

実施結果のレポート:

- [manual-user-test-report_20260803.md](./manual-user-test-report_20260803.md) — 本番環境での実施結果（2026-08-03）

| PR | タイトル | 手順 |
|---|---|---|
| [#25](https://github.com/rictaworks/questboard/pull/25) | 脅威モデル・QA・UI原則のエージェント運用ドキュメントを追加 | [pr025.md](./pr025.md) |
| [#26](https://github.com/rictaworks/questboard/pull/26) | Next.js雛形・多言語対応基盤・デザイントークンを追加 | [pr026.md](./pr026.md) |
| [#27](https://github.com/rictaworks/questboard/pull/27) | Rails APIの雛形を追加（環境別DB切り替え・ヘルスチェック・管理画面BASIC認証・CORS） | [pr027.md](./pr027.md) |
| [#28](https://github.com/rictaworks/questboard/pull/28) | Gin製sync-serverの雛形を追加（ヘルスチェック・WebSocketボードルーティング） | [pr028.md](./pr028.md) |
| [#29](https://github.com/rictaworks/questboard/pull/29) | Questboardのデータベーススキーマと冪等マスタシードを追加 | [pr029.md](./pr029.md) |
| [#36](https://github.com/rictaworks/questboard/pull/36) | Googleログイン認証とreCAPTCHA付きセッション確立を追加 | [pr036.md](./pr036.md) |
| [#37](https://github.com/rictaworks/questboard/pull/37) | CI必須要件対応: GitHub Actionsワークフロー追加 | [pr037.md](./pr037.md) |
| [#39](https://github.com/rictaworks/questboard/pull/39) | F7 権限判定関数（PermissionService）を追加 | [pr039.md](./pr039.md) |
| [#41](https://github.com/rictaworks/questboard/pull/41) | ボード作成・共有URL招待・オーナー限定ロール変更を追加 | [pr041.md](./pr041.md) |
| [#42](https://github.com/rictaworks/questboard/pull/42) | オブジェクト(付箋/図形/テキスト/接続線/画像/フレーム)のCRUD APIを追加 | [pr042.md](./pr042.md) |
| [#47](https://github.com/rictaworks/questboard/pull/47) | F1 入力インテント解決関数（InputIntentResolver）を追加 | [pr047.md](./pr047.md) |
| [#48](https://github.com/rictaworks/questboard/pull/48) | F3 ゲームカメラ制御関数（CameraController）を追加 | [pr048.md](./pr048.md) |
| [#49](https://github.com/rictaworks/questboard/pull/49) | F2 ラジアルメニュー構成関数（RadialMenuBuilder）を追加 | [pr049.md](./pr049.md) |
| [#50](https://github.com/rictaworks/questboard/pull/50) | F4 フィードバック演出決定関数（FeedbackDirector）を追加 | [pr050.md](./pr050.md) |
| [#51](https://github.com/rictaworks/questboard/pull/51) | ボードキャンバス上のオブジェクト操作をAPI連携に統合 | [pr051.md](./pr051.md) |
| [#52](https://github.com/rictaworks/questboard/pull/52) | コメント機能のCRUD操作・バッジ表示・KPIイベント連携を追加 | [pr052.md](./pr052.md) |
| [#53](https://github.com/rictaworks/questboard/pull/53) | sync-serverにop(操作)のブロードキャスト、Redis中継、WebSocket接続数メトリクスを追加 | [pr053.md](./pr053.md) |
| [#54](https://github.com/rictaworks/questboard/pull/54) | プロパティ単位の決定的なLWW競合解決とトゥームストーンのパージ対応を追加 | [pr054.md](./pr054.md) |
| [#55](https://github.com/rictaworks/questboard/pull/55) | テキスト共同編集(CRDT)の中継とpresenceのスロットリングを追加 | [pr055.md](./pr055.md) |
| [#56](https://github.com/rictaworks/questboard/pull/56) | フロントエンドのリアルタイム同期・presenceカーソル・削除復元UXを統合 | [pr056.md](./pr056.md) |
| [#60](https://github.com/rictaworks/questboard/pull/60) | KPI分析イベントのバッチ処理・オフラインバッファリング・Rails取り込み機能を追加(偽造・PII対策込み) | [pr060.md](./pr060.md) |
| [#61](https://github.com/rictaworks/questboard/pull/61) | オンボーディングクエストをKPIイベント（F8）から進行させる | [pr061.md](./pr061.md) |
| [#63](https://github.com/rictaworks/questboard/pull/63) | 開発・テスト環境のDBをSQLiteからPostgreSQLへ移行 | [pr063.md](./pr063.md) |
| [#64](https://github.com/rictaworks/questboard/pull/64) | BASIC認証で保護されたKPI開発者ダッシュボード(SSR)を追加 | [pr064.md](./pr064.md) |
| [#66](https://github.com/rictaworks/questboard/pull/66) | 死活監視・同期メトリクス・保守運用runbookの追加(issue #23対応) | [pr066.md](./pr066.md) |
| [#68](https://github.com/rictaworks/questboard/pull/68) | UC11の演出強度設定をサーバーに永続化する | [pr068.md](./pr068.md) |
| [#69](https://github.com/rictaworks/questboard/pull/69) | SentryによるエラートラッキングをRails/Next.jsに導入 | [pr069.md](./pr069.md) |
| [#73](https://github.com/rictaworks/questboard/pull/73) | AnalyticsTrackerがグローバル関数を不正なレシーバで呼ぶ問題を修正 (#72) | [pr073.md](./pr073.md) |
| [#74](https://github.com/rictaworks/questboard/pull/74) | board-create-panel の未使用コード（AnalyticsTracker 参照ほか）を削除 | [pr074.md](./pr074.md) |
