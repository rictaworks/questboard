# 本番環境ユーザーテスト結果レポート（2026-08-16）

- 対象環境: 本番 `https://questboard.rictaworks.jp` / `https://api.questboard.rictaworks.jp`（Vercel + Railway）
- 対象ボード:
  - `E2Eテストボード`（共有トークン `Shp2XLsHagz8MGxw4A3AMKw3`、オーナー: Chart Design）
  - `Ricta Works動作確認ボード`（共有トークン `utr2xL2h6eAfcNPfZ5rViKwv`、オーナー: Ricta Works）
- 実施方法: ブラウザ2種（実Chrome＝Chart Designアカウント／サンドボックスBrowser＝Ricta Worksアカウント）を別プロセス・別Cookie空間として同時に開き、2アカウント同時テストを実施
- 権限・ロール系の手順で必要な2アカウント目は、当初 `@rictaworks` の構造上フォロー不可でブロックされていたが、admin管理画面の手動許可機能（PR #161・#184・#186で修正）により本セッション中に解消
- ロジック層のみのPR（画面を持たない変更）は、各PR自体のCI実行結果を証跡とする

## 結果サマリ

| PR | 概要 | 結果 |
|---|---|---|
| [#159](./pr159.md) | Xフォロー対象ハンドルの正規化 | ✅ CI（node --test）で確認 |
| [#160](./pr160.md) | ログアウト後のセッション同期 | ✅ 本番で確認（ログアウト後、上部・下部とも正しく未ログイン状態に切り替わる） |
| [#161](./pr161.md) | admin/users のPlanマスタ欠落対応 | ⚠️ ソースコード上の修正（`find_or_create_by_code!`）は確認。マスタ削除を伴う本来の手順はDB操作が必要なため未実施 |
| [#163](./pr163.md) | pr142.md 検索語修正 | ✅ GitHub diffで確認 |
| [#164](./pr164.md) | FollowerCacheSync 自己修復化 | ✅ CI（RSpec/RuboCop/Brakeman）で確認 |
| [#165](./pr165.md) | board_members インデックス追加 | ✅ CI（画面のない変更のためCI green＝確認完了） |
| [#166](./pr166.md) | seed/マイグレーションのインデックス名共有 | ✅ CI（画面のない変更のためCI green＝確認完了） |
| [#167](./pr167.md) | request spec 共通ヘルパー集約 | ✅ CI（画面のない変更のためCI green＝確認完了） |
| [#168](./pr168.md) | 自分のボード一覧 | ✅ 手順1〜9すべて合格 |
| [#169](./pr169.md) | 共通フッター・法務ページ | ✅ 手順1〜9すべて合格 |
| [#170](./pr170.md) | PermissionService target_state キー限定 | ⚠️ 手順1（フレームロック解除権限）✅合格／手順2（コメント編集権限）❌不合格 → [Issue #189](https://github.com/rictaworks/questboard/issues/189) |
| [#172](./pr172.md) | tombstone復元権限の分離 | ⚠️ パート1（自動テスト）はCIで確認。パート2（画面での閲覧者権限確認）は未実施 |
| [#173](./pr173.md) | 削除の2段階確認ボタン | ❌ 不合格。削除復元トーストが本番で一切表示されない → [Issue #182](https://github.com/rictaworks/questboard/issues/182) |
| [#177](./pr177.md) | ユーザー削除時のFK on_delete方針 | ✅ CI（画面のない変更のためCI green＝確認完了） |
| [#178](./pr178.md) | resync状態管理の回帰テスト | ✅ 手順1（自動テスト）・手順2（画面確認）とも合格 |
| [#179](./pr179.md) | ユーザーメニュー表示 | ✅ 手順4・5すべて合格 |
| [#184](./pr184.md) | admin/users 500エラー修正（flash復元） | ⚠️ 見出し表示（手順3）は合格。バリデーションflash（手順4〜5）・手動許可トグル（手順6〜7）は初回リリース時点で不合格 → [Issue #181](https://github.com/rictaworks/questboard/issues/181)再オープン、[Issue #187](https://github.com/rictaworks/questboard/issues/187) |
| [#186](./pr186.md) | Rack::MethodOverride欠落修正 | ✅ 手順1〜6すべて合格（手動許可トグルが正常動作し、Ricta Worksアカウントが実際にmemberプランへ切り替わることを確認） |

対象外（過去レポート済みまたはドキュメントPRのため）: #180・#188（e2eドキュメント追加のみ）、#174〜176（WIPのままCLOSED）、#185（DRAFTのまま未マージ）

## 検出した不具合

| Issue | 内容 | 検出元 | 深刻度 |
|---|---|---|---|
| [#181](https://github.com/rictaworks/questboard/issues/181) | admin/users の500エラー（#158とは別原因：`config.api_only`によるFlash/Rack::MethodOverrideミドルウェア欠落） | PR #184本番検証中 | 高（PR #184・#186で解消済み） |
| [#182](https://github.com/rictaworks/questboard/issues/182) | オブジェクト削除時の復元トーストが本番で一切表示されない | PR #173 手順3 | 中（未修正） |
| [#183](https://github.com/rictaworks/questboard/issues/183) | ボードキャンバスの表示領域が画面いっぱいに使われていない（max-width制約、フッター/メニュー常時展開） | 実機確認中の本人指摘 | 低（機能要望） |
| [#187](https://github.com/rictaworks/questboard/issues/187) | admin/users新規ユーザー追加フォームでバリデーションエラーのflashが表示されない | PR #184 手順4〜5 | 中（未修正、原因未特定） |
| [#189](https://github.com/rictaworks/questboard/issues/189) | 他ユーザーが投稿したコメントを別アカウントから編集できる（権限チェック欠落、API層でも未拒否） | PR #170 手順2 | **高（セキュリティ、未修正）** |

## 詳細

### PR #170 — フレームロック・コメント編集権限（2アカウントテスト）

**手順1: フレームのロック・ロック解除**

1. Aさん（Ricta Works、オーナー）がフレームを作成しロック → 「あなたがロック中」表示 ✅
2. Bさん（Chart Design、編集者）の画面では「ロック中」とだけ表示され、ロックアイコンをクリックしても状態が変化しない ✅（合格：ロックした本人以外は解除できない）

**手順2: コメントの編集権限**

1. Aさんがフレームにコメント「Aさんのコメント」を投稿 → 投稿者自身には「編集」「削除」ボタンが表示される ✅
2. Bさんの画面でも同じコメントに「編集」「削除」ボタンが表示されている ❌
3. Bさんが「編集」→本文を「Bさんが不正編集」に変更→「保存」 → エラーなく保存される ❌
4. Aさんの画面をリロード → 投稿者表示は「Ricta Works」のままだが、本文が「Bさんが不正編集」に書き換わっている ❌（サーバー側に永続化。フロントエンドの表示制御だけでなくAPI層でも権限チェックが機能していない）

→ [Issue #189](https://github.com/rictaworks/questboard/issues/189) として起票（セキュリティ）。改ざんされたテストコメントは証跡としてそのまま本番に残置。

### PR #184 / #186 — admin/users 修正の経緯

1. PR #184マージ直後、`/admin/users` の見出し表示・一覧表示は正常化を確認
2. しかし空欄フォーム送信時のバリデーションエラーflashが表示されない（[Issue #187](https://github.com/rictaworks/questboard/issues/187)として切り出し）
3. 「ログインを許可」ボタン（手動許可トグル）を押しても強制リロード後も状態が変化せず、成功メッセージも出ないことを確認 → [Issue #181](https://github.com/rictaworks/questboard/issues/181)を再オープン
4. Copilotクラウドエージェントが `Rack::MethodOverride` 欠落を原因として特定・PR #186で修正
5. PR #186マージ・デプロイ後に再実機検証：「ログインを許可」ボタンで「手動ログイン許可状態を更新しました。」の成功メッセージが表示され、Ricta Worksアカウントの状態が `NONE` → `MEMBER`（手動許可中）に切り替わることを確認 ✅
6. これにより、`@rictaworks` 自身のため自分をフォローできず今までブロックされていたRicta Works公式アカウントでのテストが初めて可能になった
