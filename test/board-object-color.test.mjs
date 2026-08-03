import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/board-object-color.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

const {resolveObjectColorHex, objectColorStyle} = await loadModule();

const palettes = [
  {id: 1, hex: '#f87171'},
  {id: 2, hex: '#34d399'},
  {id: 3, hex: '#abc'},
];

test('resolveObjectColorHex maps a colorId to its palette hex', () => {
  assert.equal(resolveObjectColorHex(palettes, 1), '#f87171');
  assert.equal(resolveObjectColorHex(palettes, 2), '#34d399');
  assert.equal(resolveObjectColorHex(palettes, 3), '#abc');
});

test('resolveObjectColorHex falls back to null for unknown or malformed input', () => {
  assert.equal(resolveObjectColorHex(palettes, 99), null);
  assert.equal(resolveObjectColorHex(palettes, null), null);
  assert.equal(resolveObjectColorHex(palettes, undefined), null);
  assert.equal(resolveObjectColorHex(palettes, Number.NaN), null);
  assert.equal(resolveObjectColorHex(null, 1), null);
  assert.equal(resolveObjectColorHex(undefined, 1), null);
  assert.equal(resolveObjectColorHex([], 1), null);
});

test('resolveObjectColorHex rejects hex values that are not plain color literals', () => {
  assert.equal(resolveObjectColorHex([{id: 1, hex: 'red'}], 1), null);
  assert.equal(resolveObjectColorHex([{id: 1, hex: '#f87171; background: url(https://example.com/x.png)'}], 1), null);
  assert.equal(resolveObjectColorHex([{id: 1, hex: '#ff'}], 1), null);
  assert.equal(resolveObjectColorHex([{id: 1, hex: 123}], 1), null);
});

test('objectColorStyle emits the CSS custom property only when the color resolves', () => {
  assert.deepEqual(objectColorStyle(palettes, 2), {'--object-color': '#34d399'});
  assert.deepEqual(objectColorStyle(palettes, 99), {});
  assert.deepEqual(objectColorStyle([], 1), {});
});
