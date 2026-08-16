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
