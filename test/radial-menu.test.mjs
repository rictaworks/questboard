import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

// radial-menu.ts は board-permissions.ts を値 import するため、依存側を先に
// transpile して require シムで解決する（board-realtime.test.mjs と同じ方式）。
async function transpile(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });
  return outputText;
}

async function loadModule(relativePath, mocks = {}) {
  const outputText = await transpile(relativePath);
  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => (specifier in mocks ? mocks[specifier] : require(specifier));
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const boardPermissions = await loadModule('src/lib/board-permissions.ts');
const {buildRadialMenuItems, RADIAL_CREATE_TYPE_CODES} = await loadModule('src/lib/radial-menu.ts', {
  './board-permissions': boardPermissions,
});

const OBJECT_TYPES = ['sticky', 'shape', 'text', 'connector', 'image', 'frame'];

function keysOf(items) {
  return items.map((item) => item.key);
}

test('空白右クリック（owner/editor）はモックと同じ4種の作成メニューを返す', () => {
  for (const roleCode of ['owner', 'editor']) {
    const items = buildRadialMenuItems({
      roleCode,
      currentUserId: 1,
      target: null,
      objectTypeCodes: OBJECT_TYPES,
    });
    assert.deepEqual(keysOf(items), ['create-sticky', 'create-shape', 'create-text', 'create-frame']);
    for (const item of items) {
      assert.equal(item.kind, 'create');
      assert.ok(item.labelKey, 'ラベルキーが必要（生のcodeを表示しない）');
    }
  }
});

test('空白メニューはバックエンドの objectTypes に存在する種別だけを出す', () => {
  const items = buildRadialMenuItems({
    roleCode: 'owner',
    currentUserId: 1,
    target: null,
    objectTypeCodes: ['sticky', 'frame'],
  });
  assert.deepEqual(keysOf(items), ['create-sticky', 'create-frame']);
});

test('RADIAL_CREATE_TYPE_CODES はモックのラジアル作成4種と一致する', () => {
  assert.deepEqual([...RADIAL_CREATE_TYPE_CODES], ['sticky', 'shape', 'text', 'frame']);
});

test('viewer はどの対象でも空のメニュー（呼び出し側がトーストを出す）', () => {
  assert.deepEqual(
    buildRadialMenuItems({roleCode: 'viewer', currentUserId: 1, target: null, objectTypeCodes: OBJECT_TYPES}),
    []
  );
  assert.deepEqual(
    buildRadialMenuItems({
      roleCode: 'viewer',
      currentUserId: 1,
      target: {objectId: 9, locked: false, lockedByUserId: null, lockOriginObjectId: null},
      objectTypeCodes: OBJECT_TYPES,
    }),
    []
  );
});

test('commenter は空白では作成できず、オブジェクト上はコメントのみ', () => {
  assert.deepEqual(
    buildRadialMenuItems({roleCode: 'commenter', currentUserId: 1, target: null, objectTypeCodes: OBJECT_TYPES}),
    []
  );
  const items = buildRadialMenuItems({
    roleCode: 'commenter',
    currentUserId: 1,
    target: {objectId: 9, locked: false, lockedByUserId: null, lockOriginObjectId: null},
    objectTypeCodes: OBJECT_TYPES,
  });
  assert.deepEqual(keysOf(items), ['comment']);
});

test('editor がロックされていないオブジェクトを開くと 色・複製・ロック・削除・コメント', () => {
  const items = buildRadialMenuItems({
    roleCode: 'editor',
    currentUserId: 1,
    target: {objectId: 9, locked: false, lockedByUserId: null, lockOriginObjectId: null},
    objectTypeCodes: OBJECT_TYPES,
  });
  assert.deepEqual(keysOf(items), ['color', 'duplicate', 'lock', 'delete', 'comment']);
});

test('自分がロックしたオブジェクトはロック解除を出す', () => {
  const items = buildRadialMenuItems({
    roleCode: 'editor',
    currentUserId: 1,
    target: {objectId: 9, locked: true, lockedByUserId: 1, lockOriginObjectId: 9},
    objectTypeCodes: OBJECT_TYPES,
  });
  assert.ok(keysOf(items).includes('unlock'));
  assert.equal(keysOf(items).includes('lock'), false);
});

test('他人がロックしたオブジェクトは editor にはコメントのみ、owner にはロック解除を含む操作を出す', () => {
  const lockedByOther = {objectId: 9, locked: true, lockedByUserId: 2, lockOriginObjectId: 9};

  const editorItems = buildRadialMenuItems({
    roleCode: 'editor',
    currentUserId: 1,
    target: lockedByOther,
    objectTypeCodes: OBJECT_TYPES,
  });
  assert.deepEqual(keysOf(editorItems), ['comment']);

  const ownerItems = buildRadialMenuItems({
    roleCode: 'owner',
    currentUserId: 1,
    target: lockedByOther,
    objectTypeCodes: OBJECT_TYPES,
  });
  assert.ok(keysOf(ownerItems).includes('unlock'));
  assert.ok(keysOf(ownerItems).includes('delete'));
});

test('フレームロックの継承先（lockOriginObjectId が別オブジェクト）ではロック解除を出さない', () => {
  const inherited = {objectId: 9, locked: true, lockedByUserId: 1, lockOriginObjectId: 3};
  const items = buildRadialMenuItems({
    roleCode: 'owner',
    currentUserId: 1,
    target: inherited,
    objectTypeCodes: OBJECT_TYPES,
  });
  assert.equal(keysOf(items).includes('unlock'), false);
  assert.equal(keysOf(items).includes('lock'), false);
});
