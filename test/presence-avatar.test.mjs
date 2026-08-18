import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/presence-avatar.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });
  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const {avatarInitial, avatarColorIndex, resolveAvatarRoster, AVATAR_COLOR_COUNT, AVATAR_MAX_VISIBLE} =
  await loadModule();

test('avatarInitial は表示名の先頭1文字（サロゲートペア対応）を返す', () => {
  assert.equal(avatarInitial('田中太郎'), '田');
  assert.equal(avatarInitial('  鈴木  '), '鈴');
  assert.equal(avatarInitial('Ada Lovelace'), 'A');
  // サロゲートペア（絵文字等）でも文字化けせず1文字として扱う
  assert.equal(avatarInitial('𠮷田'), '𠮷');
});

test('avatarInitial は空文字・空白のみならフォールバック文字を返す', () => {
  assert.equal(avatarInitial(''), '?');
  assert.equal(avatarInitial('   '), '?');
});

test('avatarColorIndex は決定的で色数の範囲に収まる', () => {
  const names = ['田中', '鈴木', 'あおい', 'Ada', 'Grace', ''];
  for (const name of names) {
    const first = avatarColorIndex(name);
    assert.equal(avatarColorIndex(name), first, '同じ入力は常に同じ色');
    assert.ok(Number.isInteger(first) && first >= 0 && first < AVATAR_COLOR_COUNT);
  }
});

test('resolveAvatarRoster は上限までを可視化し、超過数を返す', () => {
  const participants = Array.from({length: AVATAR_MAX_VISIBLE + 3}, (_, index) => ({
    key: `user-${index}`,
    displayName: `メンバー${index}`,
  }));

  const roster = resolveAvatarRoster(participants);
  assert.equal(roster.visible.length, AVATAR_MAX_VISIBLE);
  assert.equal(roster.overflowCount, 3);
  assert.equal(roster.visible[0].key, 'user-0');
  assert.equal(roster.visible[0].initial, 'メ');
  assert.ok(roster.visible.every((entry) => entry.colorIndex >= 0 && entry.colorIndex < AVATAR_COLOR_COUNT));
});

test('resolveAvatarRoster は上限以下ならそのまま返し、超過数は0', () => {
  const roster = resolveAvatarRoster([{key: 'me', displayName: '田中'}]);
  assert.equal(roster.visible.length, 1);
  assert.equal(roster.overflowCount, 0);
});
