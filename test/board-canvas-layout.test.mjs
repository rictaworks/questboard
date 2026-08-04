import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('board canvas shell is constrained to the viewport and sidebar panels can scroll independently', async () => {
  const styles = await read('src/app/globals.css');

  assert.match(styles, /\.home-shell:has\(\.board-canvas-shell\) \{[\s\S]*height: 100dvh;/);
  assert.match(styles, /\.board-canvas-shell \{[\s\S]*height: 100%;/);
  assert.match(styles, /\.board-canvas-shell \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);/);
  assert.match(styles, /\.board-canvas-body \{[\s\S]*flex: 1;[\s\S]*min-height: 0;[\s\S]*align-items: start;/);
  assert.match(styles, /\.board-sidebar \{[\s\S]*align-self: stretch;[\s\S]*min-height: 0;/);
  assert.match(styles, /\.board-quest-panel,\s*\.board-minimap,\s*\.board-details \{[\s\S]*min-height: 0;[\s\S]*overflow: auto;/);
});
