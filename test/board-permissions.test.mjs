import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/board-permissions.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

const {canPerformBoardAction} = await loadModule();

test('board permissions respect lock ownership and role boundaries', () => {
  assert.equal(canPerformBoardAction('viewer', 'view'), true);
  assert.equal(canPerformBoardAction('viewer', 'create'), false);
  assert.equal(canPerformBoardAction('editor', 'move', {locked: false}), true);
  assert.equal(canPerformBoardAction('editor', 'move', {locked: true, lockedByUserId: 2}, 1), false);
  assert.equal(canPerformBoardAction('editor', 'move', {locked: true, lockedByUserId: 2}, 2), true);
  assert.equal(canPerformBoardAction('editor', 'unlock', {locked: true, lockedByUserId: 2}, 2), true);
  assert.equal(canPerformBoardAction('commenter', 'delete'), false);
});
