import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/components/board-user-menu.tsx'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => {
    if (specifier === '@/lib/board-permissions') {
      return {__esModule: true, type: {}, BoardRoleCode: undefined};
    }

    if (specifier === '@/lib/board-role-label') {
      return {
        resolveRoleLabelKey: (roleCode) => ({
          owner: 'ownerRole',
          editor: 'editorRole',
          commenter: 'commenterRole',
          viewer: 'viewerRole'
        })[roleCode] ?? null
      };
    }

    if (specifier === 'next-intl') {
      return {
        useTranslations: () => (key) => ({
          unknownUser: '不明なユーザー',
          ownerRole: 'オーナー',
          editorRole: '編集者',
          commenterRole: 'コメント可',
          viewerRole: '閲覧者',
          signOut: 'ログアウト'
        })[key]
      };
    }

    if (specifier === '@fortawesome/free-solid-svg-icons') {
      return {faChevronDown: {}, faRightFromBracket: {}, faUser: {}};
    }

    if (specifier === '@fortawesome/react-fontawesome') {
      const React = require('react');
      return {
        FontAwesomeIcon: (props) => React.createElement('svg', props)
      };
    }

    return require(specifier);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const {default: BoardUserMenu} = await loadModule();
const {renderToStaticMarkup} = await import('react-dom/server');
const React = await import('react');

test('board user menu shows the current role, icon trigger, and logout action', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardUserMenu, {
    displayName: 'Ada Lovelace',
    onSignOut: () => {},
    roleCode: 'owner'
  }));
  const summaryMarkup = markup.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';

  assert.match(markup, /Ada Lovelace/);
  assert.match(markup, /オーナー/);
  assert.match(markup, /aria-label="Ada Lovelace"/);
  assert.match(summaryMarkup, /svg/);
  assert.doesNotMatch(summaryMarkup, /Ada Lovelace/);
  assert.match(markup, /ログアウト/);
});

test('board user menu falls back to the unknown user label and icon trigger', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardUserMenu, {
    displayName: '   ',
    onSignOut: () => {},
    roleCode: 'viewer'
  }));
  const summaryMarkup = markup.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';

  assert.match(markup, /不明なユーザー/);
  assert.match(markup, /閲覧者/);
  assert.match(markup, /aria-label="不明なユーザー"/);
  assert.match(summaryMarkup, /svg/);
  assert.doesNotMatch(summaryMarkup, /不明なユーザー/);
});

// 上記2件のテストは useTranslations を独自辞書でモックしているため、
// t('unknownUser') が実際の ja.json に存在しなくてもテスト自体は通ってしまう。
// board-user-menu.tsx / board-canvas-panel.tsx が useTranslations('BoardCanvas')
// 経由で呼ぶキーが、実物の ja.json の BoardCanvas 名前空間に存在することを
// 別途検証する。存在しないキーは next-intl の既定フォールバックで
// "BoardCanvas.unknownUser" のようなキーパスをそのまま画面に出してしまい、
// 画面を見るまで気づけない（フォールバック処理の禁止＝CLAUDE.md）。
test('BoardCanvas namespace in ja.json defines every key board-user-menu.tsx reads', async () => {
  const messages = JSON.parse(await readFile(path.join(root, 'src/messages/ja.json'), 'utf8'));
  const boardCanvas = messages.BoardCanvas;

  assert.ok(boardCanvas, 'BoardCanvas namespace missing from ja.json');
  for (const key of ['unknownUser', 'signOut', 'ownerRole', 'editorRole', 'commenterRole', 'viewerRole']) {
    assert.equal(typeof boardCanvas[key], 'string', `BoardCanvas.${key} missing from ja.json`);
  }
});
