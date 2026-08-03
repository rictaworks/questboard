# 本番環境ユーザーテスト結果レポート（2026-08-03）

- 対象環境: 本番 `https://questboard.rictaworks.jp`（Vercel + Railway）
- 対象ボード: `cutover-check-20260803`（共有トークン `G7Z3a2zcydHiydL2VesKFDRu`）
- 実施方法: 同一 Google アカウントでブラウザタブ2枚（タブA／タブB）を開き、`e2e/prNNN.md` の手順どおりに操作
- ロジック層のみのPRは、`main` の CI 実行結果（run `30812525170`・全7ジョブ success）を証跡とする

## 結果サマリ

| PR | 概要 | 結果 |
|---|---|---|
| [#36](./pr036.md) | Googleログイン + reCAPTCHA | ✅ 本番で確認（ローカル起動手順は該当なし） |
| [#37](./pr037.md) | CIワークフロー | ✅ 全チェック green |
| [#39](./pr039.md) | PermissionService | ✅ CI（RSpec）で確認 |
| [#41](./pr041.md) | ボード作成・共有URL招待 | ⚠️ 手順1 ✅／手順2は2アカウント必要で未実施／手順3はCIで確認 |
| [#42](./pr042.md) | オブジェクトCRUD API | ✅ CI（RSpec）＋本番UI操作で確認 |
| [#47](./pr047.md) | InputIntentResolver | ✅ CI（node --test）で確認 |
| [#48](./pr048.md) | CameraController | ✅ CI（node --test）で確認 |
| [#49](./pr049.md) | RadialMenuBuilder | ✅ CI（RSpec）で確認 |
| [#50](./pr050.md) | FeedbackDirector | ✅ CI（node --test）で確認 |
| [#51](./pr051.md) | キャンバス操作のAPI連携 | ❌ 手順10（色変更）が不合格 → Issue #87。他は合格 |
| [#52](./pr052.md) | コメントCRUD・バッジ | ⚠️ 手順1〜6 ✅／手順7〜12は2アカウント必要で未実施 |
| [#53](./pr053.md) | sync-server メトリクス | ✅ |
| [#54](./pr054.md) | LWW競合解決・トゥームストーン | ✅ |
| [#55](./pr055.md) | テキストCRDT・presenceスロットリング | ✅ |
| [#56](./pr056.md) | リアルタイム同期・presence・削除復元 | ✅ 手順1〜4すべて合格 |
| [#61](./pr061.md) | クエスト進行（KPIイベント連動） | ⚠️ テスト1〜3 ✅／テスト5は2アカウント必要で未実施 |

本レポートの対象は上記16件。#25〜#29 / #60 / #63 / #64 / #66 / #68 / #69 / #73 / #74 は本レポートの対象外。

## 検出した不具合

| Issue | 内容 | 検出元 |
|---|---|---|
| [#86](https://github.com/rictaworks/questboard/issues/86) | ページ再読み込み直後の編集がサーバーに反映されない（`lamportRef` が0から再開しLWWで拒否される） | PR #56 手順3の調査中 |
| [#87](https://github.com/rictaworks/questboard/issues/87) | オブジェクトの色を変更してもキャンバス上の見た目に反映されない（`colorId` が描画に使われていない） | PR #51 手順10 |

## 詳細

### PR #53 — sync-server メトリクス

- `/healthz` が 200 `{"status":"ok"}` を返す。
- `/metrics` が 200 で `sync_server_websocket_connections` を含む。
- タブを開閉して接続数ゲージが 2 → 1 → 2 と追従することを確認。

### PR #54 / #55 — LWW・トゥームストーン・CRDT中継

- RSpec / Go テストは CI で green。
- `go test ./internal/ws/... ./internal/server/...` をローカルでも実行し ok。
- presence のスロットリングを実測（pointermove 15回に対して送信フレーム2件・約1Hz）。

### PR #56 — リアルタイム同期・presence・削除復元

1. タブAでのドラッグがタブBへ即時反映 ✅
2. presence フレームに `displayName: "Hideki Takizawa"` が乗って届く ✅
   - 画面上にカーソルが描画されないのは、`board-canvas-panel.tsx` が自分自身の presence を除外しているため（同一アカウントでの検証のため両タブが同一ユーザー扱い）。仕様どおり。
3. オフライン→再接続でローカル保持した操作がフラッシュされ、リロード後も残る ✅
   - 検証中に Issue #86 を検出。オフライン機能自体の不具合ではないことを、オンライン時の同一操作でも再現することで切り分け済み。
4. F7 を押している間だけ「復元」ボタンが有効になり、押さずにクリックしても何も送信されない ✅
   - ブラウザ標準ダイアログ（`window.confirm`）の呼び出しは 0 回。

### PR #61 — クエスト進行

1. `frame` 作成でクエスト「フレームを作成する」が 未開始0/1 → 完了1/1 に即時遷移 ✅
2. 再読み込み後も完了状態を維持、祝福演出やトーストの再生なし ✅
3. スキップ→「スキップ済み」、再開→「進行中」 ✅
5. 他ユーザーのクエストが見えないこと → 2アカウント必要のため未実施

### PR #52 — コメント

1. オブジェクト選択で「まだコメントはありません」＋バッジ0 ✅
2. 投稿 → 投稿者名・日時つきで表示、バッジ1 ✅
3. 編集→保存 → 本文が更新、バッジは1のまま ✅
4. 削除 → 一覧から消え、バッジも消える ✅（`window.confirm` 呼び出し0回）
5. 手順7〜12（閲覧者／コメント可ロールでの権限確認）は別アカウントが必要なため未実施

### PR #51 — キャンバス操作のAPI連携

| 手順 | 内容 | 結果 |
|---|---|---|
| 1〜4 | ボード作成・共有URL・2画面表示 | ✅（既存の検証用ボードで代替） |
| 5 | オブジェクト作成 | ✅ 4個→5個 |
| 6 | もう一方の画面に反映 | ⚠️ 作成はライブ配信されず、再読み込みで反映（手順書は「開き直す」も許容） |
| 7 | 移動 | ✅ タブAで `120px,60px` → タブBにも即時反映 |
| 8 | リサイズ | ✅ `160x120` → `220x168` が両画面に反映 |
| 9 | 複製 | ✅ +24,+24 の位置に同サイズのコピー |
| 10 | 色変更 | ❌ `colorId` は保存・再読込後も保持されるが、図形の見た目が変わらない → Issue #87 |
| 11 | 削除 | ✅ 両画面から消える（`window.confirm` 呼び出し0回） |
| 12 | ロック | ✅ 「あなたがロック中」バッジを表示 |
| 13 | 他ユーザーがロック中の図形を操作できないこと | ⏸ 2アカウント必要のため未実施 |
| 14 | ロック解除 | ⚠️ 操作したタブでは即時反映。もう一方のタブは再読み込みが必要 |
| 15 | 再読み込み後もすべて保持 | ✅ |

補足: 作成・複製・ロック／解除は REST（`mutateLegacyObject`）経由で WebSocket ブロードキャストを伴わないため、他タブへは再読み込みまで反映されない。移動・リサイズ・色・削除はリアルタイム op として即時同期される。

### PR #50 / #48 / #47 — ロジック層（node --test）

`main` の CI ジョブ `Frontend / build & test (node --test)` の実行結果:

```
# tests 68
# pass 68
# fail 0
```

手順書が挙げる合格項目が個別に pass していることも確認:

- `ok 22 - FeedbackDirector covers the 12 × 3 × 2 matrix and keeps feedback non-blocking`
- `ok 26 - effect durations and event-to-effect routing stay in sync with the seeded master data`
- `ok 20 - resolveCameraRange locks camera position to content center when viewport exceeds expanded bounds`
- `ok 31 - longpress remains active on subsequent pointer moves and prevents resuming normal drag`
- `ok 32 - space key state resets on window blur to avoid stuck pan mode`

ローカル Windows には `node_modules` を作らない方針のため、手順書の `npm install` → `node --test` はローカルでは実行していない。

### PR #49 / #42 / #39 — ロジック層・API（RSpec）

`main` の CI ジョブ `Backend / RSpec`:

```
192 examples, 0 failures
```

`spec/services/radial_menu_builder_spec.rb` / `spec/requests/objects_spec.rb` / `spec/services/permission_service_spec.rb` はいずれもリポジトリに存在し、このスイートに含まれる。
PR #42 のオブジェクト CRUD は、上記 PR #51 の本番UI操作（作成・移動・リサイズ・複製・削除）でも実地に確認済み。

### PR #41 — ボード作成・共有URL招待

- 手順1: トップページの「ボードを作成」にボード名を入力して作成 → 「共有URLを作成しました」と `https://questboard.rictaworks.jp/b/GNU9NYyPaEJ7AgWAhVLLkYVb` が表示 ✅
- 手順2: 別アカウントでの参加・ロール選択 → 2アカウント必要のため未実施
- 手順3: owner以外のロール変更が403、最後のownerの降格が422（`Cannot remove the last owner`）→ `spec/requests/boards_spec.rb` に含まれ CI で green

### PR #37 — CI

`main` の最新実行（run `30812525170`）で全7ジョブが success:
RuboCop / Brakeman / Frontend build & test (node --test) / go test / RSpec / ESLint / golangci-lint。

### PR #36 — Googleログイン + reCAPTCHA

本番トップページで「ログイン済みです / Hideki Takizawa としてログインしています」を確認。
本番のログインは `src/lib/google-auth.ts` の reCAPTCHA v3 トークン取得を経由し、Rails 側 `Auth::RecaptchaVerifier` で検証される経路のみのため、ログイン成功をもって手順の合格とみなす。
手順書のローカル `.env` 設定・`rails server` / `npm run dev` 起動は本番確認では該当なし。

## 未実施項目（2ユーザー目としてのログインが必要）

- PR #41 手順2（招待URLからの参加・ロール選択）
- PR #51 手順13（他ユーザーがロックした図形を操作できないこと）
- PR #52 手順7〜12（閲覧者／コメント可ロールでの権限制御）
- PR #61 テスト5（他ユーザーのクエストが見えないこと）

未実施の理由は「2つ目の Google アカウントが存在しないこと」ではない。検証端末の Chrome には
`takizawa@rictaworks.jp`（authuser=0）と `chart.design.lab@gmail.com`（authuser=1）の2アカウントが
ログイン済みである。詰まっているのは次の2点。

1. 同一 Chrome プロファイルは Cookie ジャーが1つのため、2タブで別ユーザーのセッションを
   同時に保持できない。questboard の認証は `src/lib/google-auth.ts` の OAuth リダイレクト（PKCE）で、
   セッションはオリジン単位で全タブ共有される。したがって上記4項目は
   「ログアウト → 別アカウントでログイン」を往復する逐次実行になる。
2. そのログイン操作（Google のアカウント選択と OAuth 同意付与）は本人が行う運用としている。

いずれも権限・ロール周りの確認であり、RSpec の権限マトリクステスト（PR #39 / #41 / #52 相当）は CI で green。
実地確認は2ユーザー目のログインを行ったうえで別途実施する。
