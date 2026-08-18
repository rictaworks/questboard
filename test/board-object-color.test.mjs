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

const {resolveObjectColorHex, objectColorStyle, hexToRgbaString, pastelizeHex} = await loadModule();

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

test('objectColorStyle emits the CSS custom properties only when the color resolves', () => {
  assert.equal(objectColorStyle(palettes, 2)['--object-color'], '#34d399');
  assert.deepEqual(objectColorStyle(palettes, 99), {});
  assert.deepEqual(objectColorStyle([], 1), {});
});

// ── issue #192: モック（app-ui/Questboard Prototype.dc.html）の塗りつぶし表現 ──

test('hexToRgbaString は #RRGGBB / #RGB を rgba() に変換し、不正値は null', () => {
  assert.equal(hexToRgbaString('#7b2fff', 0.55), 'rgba(123, 47, 255, 0.55)');
  assert.equal(hexToRgbaString('#abc', 1), 'rgba(170, 187, 204, 1)');
  assert.equal(hexToRgbaString('red', 0.5), null);
  assert.equal(hexToRgbaString('#7b2fff; background: url(x)', 0.5), null);
});

test('pastelizeHex は白側へ寄せたパステル色（モックの pastel(hex, amt) 相当）を返す', () => {
  // #7b2fff を 0.55 白寄せ： r=123+(255-123)*0.55=196(round), g=47+208*0.55=161, b=255
  assert.equal(pastelizeHex('#7b2fff', 0.55), 'rgba(196, 161, 255, 0.95)');
  // amount 0 は元色のまま（不透明度のみ 0.95）
  assert.equal(pastelizeHex('#000000', 0), 'rgba(0, 0, 0, 0.95)');
  assert.equal(pastelizeHex('not-a-color', 0.5), null);
});

test('objectColorStyle は塗りつぶし用のカスタムプロパティ一式を出す', () => {
  const style = objectColorStyle(palettes, 2);
  assert.equal(style['--object-color'], '#34d399');
  assert.equal(style['--object-fill-soft'], pastelizeHex('#34d399', 0.55));
  assert.equal(style['--object-border-soft'], hexToRgbaString('#34d399', 0.55));
  assert.equal(style['--object-fill-faint'], hexToRgbaString('#34d399', 0.2));
  assert.equal(style['--object-border-strong'], hexToRgbaString('#34d399', 0.65));
  // 解決できない場合は従来どおり空（CSS 側の既定値に委ねる）
  assert.deepEqual(objectColorStyle(palettes, 99), {});
});
