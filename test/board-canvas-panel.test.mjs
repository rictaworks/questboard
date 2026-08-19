import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('restore toast uses an accessible confirmation flow instead of the F7 gate', async () => {
  const source = await readFile(path.join(root, 'src/components/board-canvas-panel.tsx'), 'utf8');

  assert.equal(source.includes('restoreGateOpen'), false);
  assert.equal(source.includes('restoreGateHint'), false);
  assert.equal(source.includes('F7'), false);
  assert.match(source, /requiresRestoreConfirmation/);
  assert.match(source, /dismissAfterMs:\s*15000/);
  assert.match(source, /restoreConfirmAction/);
  assert.match(source, /restoreCancelAction/);
  assert.doesNotMatch(source, /\b(confirm|alert|prompt)\s*\(/);
});

// issue #182: PR #173 の「削除→復元ボタン付きトースト」は issue #192 のボード画面
// 作り直しで削除経路（ラジアルメニュー）ごと消失し、削除の取り消し手段が UI から
// 完全に失われていた。削除の実行時にトーストを出すこと・op を送っていないのに
// トーストだけ出ることがないよう戻り値で分岐することを退行防止として固定する。
test('deleting an object enqueues the restore toast (issue #182 regression)', async () => {
  const source = await readFile(path.join(root, 'src/components/board-canvas-panel.tsx'), 'utf8');

  assert.match(source, /enqueueToast\(t\('objectDeleted'\)/, '削除時に復元トーストが出ていない（issue #182 の再発）');
  assert.match(
    source,
    /const deleted = sendObjectRealtimeOp\([^)]*'deleted_at'/,
    '削除 op の送出結果を確認せずにトーストを出している（権限拒否時にも復元トーストが出てしまう）'
  );
  assert.match(source, /onAction: \(\) => restoreDeletedObject\(/, '復元ボタンが restoreDeletedObject に接続されていない');
});

// issue #198: オブジェクトの操作ハンドルはモック準拠で四隅に割り当てる
// （左上=ロック・右上=回転・右下=サイズ変更・左下=コメント）。ロック・コメントを
// オブジェクト内部のピル（lock-badge / comment-badge）で出す旧UIに戻さないこと、
// サイズ変更のアイコンが編集アイコン（faPenToSquare）でないことを固定する。
test('object corner handles follow the mock layout (issue #198)', async () => {
  const source = await readFile(path.join(root, 'src/components/board-canvas-panel.tsx'), 'utf8');
  const css = await readFile(path.join(root, 'src/app/globals.css'), 'utf8');

  assert.match(source, /board-object-action-lock/, '左上のロックハンドルが無い');
  assert.match(source, /board-object-action-comment/, '左下のコメントハンドルが無い');
  assert.match(source, /faUpRightAndDownLeftFromCenter/, 'サイズ変更ハンドルのアイコンがリサイズ系でない');
  assert.doesNotMatch(source, /faPenToSquare/, 'サイズ変更に編集アイコンが使われている（機能と不一致）');
  assert.doesNotMatch(source, /className="comment-badge"/, 'コメント件数がオブジェクト内部のピル表示に戻っている');
  assert.doesNotMatch(source, /className="lock-badge"/, 'ロック状態がオブジェクト内部のピル表示に戻っている');

  // ロックハンドルは F7 権限（lock/unlock）で無効化される
  assert.match(source, /object\.locked \? 'unlock' : 'lock', objectToLockState\(object\)/);

  // CSS の四隅割り当て
  assert.match(css, /\.board-object-action-lock \{ left: -0\.6rem; top: -0\.6rem; \}/);
  assert.match(css, /\.board-object-action-comment \{ left: -0\.6rem; bottom: -0\.6rem; \}/);
  assert.match(css, /\.board-object-action-rotate \{ top: -0\.6rem; right: -0\.6rem; \}/);
  assert.match(css, /\.board-object-action-resize \{ right: -0\.6rem; bottom: -0\.6rem; \}/);
});

test('board canvas panel keeps board reload and board switch safety guards in place', async () => {
  const panelSource = await readFile(path.join(root, 'src/components/board-canvas-panel.tsx'), 'utf8');
  const inviteSource = await readFile(path.join(root, 'src/components/board-invite-panel.tsx'), 'utf8');

  assert.match(panelSource, /const coveredObjectIds = new Set\(resyncingObjectsRef\.current\);/);
  assert.match(panelSource, /const nextState = settleResyncReload\(/);
  // retry timer 待機中に effect が再実行されても再同期が永久ブロックされないよう、
  // WS再接続のクリーンアップで reconnectTimerRef を確実に null に戻す（resyncTimerRef の
  // クリーンアップと対になっている）ことを検証する。`reconnectTimerRef.current = null;`
  // という文字列単体は connectSocket 内（本PR以前から存在）にも出現するため、
  // クリーンアップブロックの構造（clearTimeout+nullが2つ連続する箇所）ごとマッチさせ、
  // このPRで追加された行が消えても検出できるようにしている。
  assert.match(
    panelSource,
    /if \(reconnectTimerRef\.current != null\) \{\s*window\.clearTimeout\(reconnectTimerRef\.current\);\s*reconnectTimerRef\.current = null;\s*\}\s*if \(resyncTimerRef\.current != null\) \{\s*window\.clearTimeout\(resyncTimerRef\.current\);\s*resyncTimerRef\.current = null;\s*\}/
  );
  assert.match(inviteSource, /key=\{boardData\.board\.shareToken\}/);
});
