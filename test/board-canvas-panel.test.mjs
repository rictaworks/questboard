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

test('board canvas panel keeps board reload and board switch safety guards in place', async () => {
  const panelSource = await readFile(path.join(root, 'src/components/board-canvas-panel.tsx'), 'utf8');
  const inviteSource = await readFile(path.join(root, 'src/components/board-invite-panel.tsx'), 'utf8');

  assert.match(panelSource, /roleCode === 'owner' \|\| comment\.userId === currentUserId/);
  assert.doesNotMatch(panelSource, /roleCode === 'editor'/);
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
