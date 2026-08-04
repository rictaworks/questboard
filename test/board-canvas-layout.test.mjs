import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function escapeSelector(selector) {
  return selector.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function declarationsOf(css, selector) {
  let escaped = escapeSelector(selector.trim());
  // Support flexible whitespace instead of strict matching
  escaped = escaped.replace(/\s+/g, '\\s*');
  escaped = escaped.replace(/,/g, '\\s*,\\s*');

  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const matched = css.match(pattern);
  if (!matched) throw new Error(`セレクタが見つかりません: ${selector}`);
  return matched[1];
}

test('board canvas shell is constrained to the viewport and sidebar panels can scroll independently', async () => {
  const styles = await read('src/app/globals.css');

  assert.match(declarationsOf(styles, '.home-shell:has(.board-canvas-shell)'), /height: 100dvh;/);
  assert.match(declarationsOf(styles, '.home-shell:has(.board-canvas-shell)'), /box-sizing: border-box;/);
  assert.match(declarationsOf(styles, '.home-shell:has(.board-canvas-shell)'), /overflow: hidden;/);
  assert.match(declarationsOf(styles, '.home-shell:has(.board-canvas-shell)'), /grid-template-rows: minmax\(0, 1fr\);/);

  assert.match(declarationsOf(styles, '.home-shell:has(.board-canvas-shell):has(.board-join-success)'), /grid-template-rows: auto minmax\(0, 1fr\);/);

  assert.match(declarationsOf(styles, '.board-canvas-shell'), /height: 100%;/);
  assert.match(declarationsOf(styles, '.board-canvas-shell'), /grid-template-rows: auto minmax\(0, 1fr\);/);

  assert.match(declarationsOf(styles, '.board-canvas-body'), /min-height: 0;/);

  assert.match(declarationsOf(styles, '.board-sidebar'), /min-height: 0;/);

  assert.match(declarationsOf(styles, '.board-quest-panel, .board-minimap, .board-details'), /min-height: 0;/);
  assert.match(declarationsOf(styles, '.board-quest-panel, .board-minimap, .board-details'), /overflow: auto;/);
});
