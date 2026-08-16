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
      return {FontAwesomeIcon: () => null};
    }

    return require(specifier);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const {default: BoardUserMenu} = await loadModule();
const {renderToStaticMarkup} = await import('react-dom/server');
const React = await import('react');

test('board user menu shows the current role, initials avatar, and logout action', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardUserMenu, {
    displayName: 'Ada Lovelace',
    onSignOut: () => {},
    roleCode: 'owner'
  }));

  assert.match(markup, /Ada Lovelace/);
  assert.match(markup, /オーナー/);
  assert.match(markup, /title="Ada Lovelace"/);
  assert.match(markup, />A<\/span>/);
  assert.match(markup, /ログアウト/);
});

test('board user menu falls back to the unknown user label and a fallback initial', () => {
  const markup = renderToStaticMarkup(React.createElement(BoardUserMenu, {
    displayName: '   ',
    onSignOut: () => {},
    roleCode: 'viewer'
  }));

  assert.match(markup, /不明なユーザー/);
  assert.match(markup, /閲覧者/);
  assert.match(markup, />不<\/span>/);
});
