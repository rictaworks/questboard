# E2E ユーザーテスト手順一覧

questboard の全マージ済みPRのユーザーテスト手順をPR本文から抽出し、PR番号順に集約したもの。各ファイルの内容は該当PR本文からの転記（要約・改変なし）。

実施結果のレポート:

- [manual-user-test-report_20260803.md](./manual-user-test-report_20260803.md) — 本番環境での実施結果（2026-08-03）
- [manual-user-test-report_20260816.md](./manual-user-test-report_20260816.md) — 本番環境での実施結果（2026-08-16）

| PR | タイトル | 手順 |
|---|---|---|
| [#25](https://github.com/rictaworks/questboard/pull/25) | 脅威モデル・QA・UI原則のエージェント運用ドキュメントを追加 | [pr025.md](./pr025.md) |
| [#26](https://github.com/rictaworks/questboard/pull/26) | Next.js雛形・多言語対応基盤・デザイントークンを追加 | [pr026.md](./pr026.md) |
| [#27](https://github.com/rictaworks/questboard/pull/27) | Rails APIの雛形を追加（環境別DB切り替え・ヘルスチェック・管理画面BASIC認証・CORS） | [pr027.md](./pr027.md) |
| [#28](https://github.com/rictaworks/questboard/pull/28) | Gin製sync-serverの雛形を追加（ヘルスチェック・WebSocketボードルーティング） | [pr028.md](./pr028.md) |
| [#29](https://github.com/rictaworks/questboard/pull/29) | Questboardのデータベーススキーマと冪等マスタシードを追加 | [pr029.md](./pr029.md) |
| [#36](https://github.com/rictaworks/questboard/pull/36) | Xログイン認証とreCAPTCHA付きセッション確立を追加 | [pr036.md](./pr036.md) |
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
| [#139](https://github.com/rictaworks/questboard/pull/139) | usersテーブルをXユーザーID化し、plans/follower_cacheマスタを新設 | [pr139.md](./pr139.md) |
| [#140](https://github.com/rictaworks/questboard/pull/140) | 製品版 F1: ペンをポインタ同等に扱い、描画分岐を除去 | [pr140.md](./pr140.md) |
| [#141](https://github.com/rictaworks/questboard/pull/141) | ピンチズームの基準点とリリース時速度を @use-gesture の値に統一 | [pr141.md](./pr141.md) |
| [#142](https://github.com/rictaworks/questboard/pull/142) | 設計書を製品版仕様（Xログイン＋フォロワー判定）へ整合させる | [pr142.md](./pr142.md) |
| [#143](https://github.com/rictaworks/questboard/pull/143) | GoogleログインをXログイン（OAuth 2.0 + PKCE）に置き換え | [pr143.md](./pr143.md) |
| [#144](https://github.com/rictaworks/questboard/pull/144) | F9: フォロワーキャッシュ照合でプランを付与する | [pr144.md](./pr144.md) |
| [#145](https://github.com/rictaworks/questboard/pull/145) | F9: フォロワーキャッシュの定期同期とアンフォロー検出を追加 | [pr145.md](./pr145.md) |
| [#146](https://github.com/rictaworks/questboard/pull/146) | プラン値ベースの機能ゲートを追加し、フォロー判定依存を排除 | [pr146.md](./pr146.md) |
| [#147](https://github.com/rictaworks/questboard/pull/147) | 手動フォロー再判定（15分クールダウン）とmember以外のプラン向け利用不可画面を追加 | [pr147.md](./pr147.md) |
| [#148](https://github.com/rictaworks/questboard/pull/148) | apply_op のrescue範囲不具合(#121)に対する回帰テストを追加 | [pr148.md](./pr148.md) |
| [#149](https://github.com/rictaworks/questboard/pull/149) | `:has()` 非対応環境でも board stage が潰れないように最小高さを既定化 | [pr149.md](./pr149.md) |
| [#150](https://github.com/rictaworks/questboard/pull/150) | ボードキャンバスのレイアウトにPlaywrightでの回帰テストを追加 | [pr150.md](./pr150.md) |
| [#151](https://github.com/rictaworks/questboard/pull/151) | fix: 既存メンバーの共有URLアクセス時にロールを表示する (#97) | [pr151.md](./pr151.md) |
| [#152](https://github.com/rictaworks/questboard/pull/152) | サイドバーの入れ子スクロール発生をミニマップの可変高さ化で軽減 | [pr152.md](./pr152.md) |
| [#159](https://github.com/rictaworks/questboard/pull/159) | Xフォロー対象ハンドルの正規化によるプロフィールリンク修正 | [pr159.md](./pr159.md) |
| [#160](https://github.com/rictaworks/questboard/pull/160) | ログアウト後にセッション依存パネルを再読み込みして古い利用不可表示を解消 | [pr160.md](./pr160.md) |
| [#161](https://github.com/rictaworks/questboard/pull/161) | プランの初期データが無い場合に /admin/users が500エラーになる不具合を修正 | [pr161.md](./pr161.md) |
| [#163](https://github.com/rictaworks/questboard/pull/163) | PR142のユーザーテスト手順の検索語を修正しBASIC認証との誤判定を防止 | [pr163.md](./pr163.md) |
| [#164](https://github.com/rictaworks/questboard/pull/164) | FollowerCacheSync の Plan 参照を自己修復型に統一 | [pr164.md](./pr164.md) |
| [#165](https://github.com/rictaworks/questboard/pull/165) | board_membersにuser_idインデックスを追加してユーザー別ボード検索を高速化 | [pr165.md](./pr165.md) |
| [#166](https://github.com/rictaworks/questboard/pull/166) | seedとマイグレーションでユニークインデックス名を共有する | [pr166.md](./pr166.md) |
| [#167](https://github.com/rictaworks/questboard/pull/167) | リクエストスペックの共通ヘルパーをspec/supportに集約 | [pr167.md](./pr167.md) |
| [#168](https://github.com/rictaworks/questboard/pull/168) | ログイン後トップに自分のボード一覧を追加する | [pr168.md](./pr168.md) |
| [#169](https://github.com/rictaworks/questboard/pull/169) | 共通フッターと法務情報ページを追加 | [pr169.md](./pr169.md) |
| [#170](https://github.com/rictaworks/questboard/pull/170) | PermissionServiceのtarget_stateキーを現在の呼び出し契約に限定 | [pr170.md](./pr170.md) |
| [#172](https://github.com/rictaworks/questboard/pull/172) | tombstone復元権限をdelete権限から分離する | [pr172.md](./pr172.md) |
| [#173](https://github.com/rictaworks/questboard/pull/173) | 削除の復元操作をF7同時押しから2段階確認ボタン方式に変更（アクセシビリティ改善） | [pr173.md](./pr173.md) |
| [#177](https://github.com/rictaworks/questboard/pull/177) | ユーザー削除時の外部キー挙動を明文化してFK制約を整理 | [pr177.md](./pr177.md) |
| [#178](https://github.com/rictaworks/questboard/pull/178) | ボードのリアルタイム再同期（resync）状態管理の回帰テスト追加と不具合修正 | [pr178.md](./pr178.md) |
| [#179](https://github.com/rictaworks/questboard/pull/179) | ボード画面にログイン中ユーザーの表示とロール付きメニューを追加 | [pr179.md](./pr179.md) |
| [#184](https://github.com/rictaworks/questboard/pull/184) | 管理者ユーザー管理画面のHTTP 500エラーを修正（flashサポート復元） | [pr184.md](./pr184.md) |
| [#186](https://github.com/rictaworks/questboard/pull/186) | 管理ユーザー画面のRack::MethodOverride欠落を修正（手動ログイン許可トグルが本番で機能しない不具合） | [pr186.md](./pr186.md) |
