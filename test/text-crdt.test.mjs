import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule(relativePath, mocks = {}) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => (specifier in mocks ? mocks[specifier] : require(specifier));

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const textCrdt = await loadModule('src/lib/text-crdt.ts');

test('textFromCrdt concatenates insert runs and tolerates malformed state', () => {
  assert.equal(textCrdt.textFromCrdt({ops: [{insert: 'こんにちは'}, {insert: '世界', attributes: {bold: true}}]}), 'こんにちは世界');
  assert.equal(textCrdt.textFromCrdt(null), '');
  assert.equal(textCrdt.textFromCrdt({}), '');
  assert.equal(textCrdt.textFromCrdt({ops: [{insert: 42}, {insert: 'ok'}]}), 'ok');
});

test('diffToOps produces minimal retain/delete/insert ops', () => {
  assert.deepEqual(textCrdt.diffToOps('', 'abc'), [{insert: 'abc'}]);
  assert.deepEqual(textCrdt.diffToOps('abc', ''), [{delete: 3}]);
  assert.deepEqual(textCrdt.diffToOps('abc', 'abc'), []);
  assert.deepEqual(textCrdt.diffToOps('abcdef', 'abXYef'), [{retain: 2}, {delete: 2}, {insert: 'XY'}]);
  assert.deepEqual(textCrdt.diffToOps('メモ', 'メモ帳'), [{retain: 2}, {insert: '帳'}]);
});

// 絵文字（サロゲートペア）の途中に retain/delete 境界を落とすと、バックエンドの
// Utf16Text.valid_boundary? 検証で 422 になる。境界補正を固定する。
test('diffToOps never splits a surrogate pair', () => {
  const ops = textCrdt.diffToOps('a😀b', 'a😁b');
  // 共通prefixはコードユニット比較だと 'a' + 高位サロゲートまで一致するが、
  // ペアの手前（retain 1）まで戻ることを確認する
  assert.deepEqual(ops, [{retain: 1}, {delete: 2}, {insert: '😁'}]);

  const roundtrip = textCrdt.composeCrdt({ops: [{insert: 'a😀b'}]}, ops);
  assert.equal(textCrdt.textFromCrdt(roundtrip), 'a😁b');
});

test('composeCrdt applies retain/delete/insert over runs and preserves attributes', () => {
  const state = {ops: [{insert: 'Hello ', attributes: {bold: true}}, {insert: 'world'}]};

  // "Hello world" → "Hello brave world"
  const next = textCrdt.composeCrdt(state, [{retain: 6}, {insert: 'brave '}]);
  assert.equal(textCrdt.textFromCrdt(next), 'Hello brave world');
  // 先頭 run の attributes が保持されている
  assert.deepEqual(next.ops[0], {insert: 'Hello ', attributes: {bold: true}});

  // 削除が run 境界をまたぐケース（'Hello world' の 3 文字目から 5 文字削除）
  const deleted = textCrdt.composeCrdt(state, [{retain: 3}, {delete: 5}]);
  assert.equal(textCrdt.textFromCrdt(deleted), 'Helrld');
});

test('composeCrdt roundtrips with diffToOps for successive edits', () => {
  let state = {ops: []};
  const versions = ['', 'メモ', 'メモを書く', 'メモを消して書く', '全部書き直した'];

  for (let i = 1; i < versions.length; i += 1) {
    const ops = textCrdt.diffToOps(versions[i - 1], versions[i]);
    state = textCrdt.composeCrdt(state, ops);
    assert.equal(textCrdt.textFromCrdt(state), versions[i], `version ${i}`);
  }
});
