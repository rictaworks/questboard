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
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => {
    if (specifier in mocks) {
      return mocks[specifier];
    }

    if (specifier === 'next-intl') {
      return {useTranslations: () => (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key)};
    }

    if (specifier === '@fortawesome/free-solid-svg-icons') {
      return {faCircleExclamation: {}, faSpinner: {}, faUserPlus: {}};
    }

    if (specifier === '@fortawesome/react-fontawesome') {
      return {FontAwesomeIcon: () => null};
    }

    return require(specifier);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const {renderToStaticMarkup} = await import('react-dom/server');
const React = await import('react');

const PANEL_PATH = 'src/components/plan-unavailable-panel.tsx';

// Issue #133 の受け入れ要件は「フォロー案内」を求めている。どのアカウントを
// フォローすればよいのか示されていなければ案内として成立しないため、
// ハンドル名とプロフィールへのリンクの両方を必須とする。
test('plan unavailable panel names the follow target and links to its profile', async () => {
  const {default: PlanUnavailablePanel} = await loadModule(PANEL_PATH, {
    '@/lib/x-auth': {
      buildXProfileUrl: (handle) => `https://x.com/${handle}`,
      readFollowTargetHandle: () => 'rictaworks'
    }
  });

  const markup = renderToStaticMarkup(React.createElement(PlanUnavailablePanel, {
    errorMessage: null,
    headingId: 'board-create-heading',
    headingLevel: 'h2',
    onManualRecheck: async () => {},
    rechecking: false
  }));

  assert.match(markup, /@rictaworks/);
  assert.match(markup, /href="https:\/\/x\.com\/rictaworks"/);
  assert.match(markup, /rel="[^"]*noopener[^"]*"/);
  assert.match(markup, /target="_blank"/);
});

// 親セクションが aria-labelledby でこのIDを参照するため、見出しが無いと
// 参照先が存在しないIDになり、スクリーンリーダーでセクション名が失われる。
test('plan unavailable panel renders a heading with the id its parent references', async () => {
  const {default: PlanUnavailablePanel} = await loadModule(PANEL_PATH, {
    '@/lib/x-auth': {
      buildXProfileUrl: (handle) => `https://x.com/${handle}`,
      readFollowTargetHandle: () => 'rictaworks'
    }
  });

  const markup = renderToStaticMarkup(React.createElement(PlanUnavailablePanel, {
    errorMessage: null,
    headingId: 'board-create-heading',
    headingLevel: 'h2',
    onManualRecheck: async () => {},
    rechecking: false
  }));

  assert.match(markup, /<h2 id="board-create-heading"/);
});

// 共有URLのページはページレベルの h1 を持たず、各分岐が自前で h1 を出している。
// このパネルだけ h2 固定にすると、none プランの利用者には h1 の無いページが出る。
test('plan unavailable panel follows the heading level its page needs', async () => {
  const {default: PlanUnavailablePanel} = await loadModule(PANEL_PATH, {
    '@/lib/x-auth': {
      buildXProfileUrl: (handle) => `https://x.com/${handle}`,
      readFollowTargetHandle: () => 'rictaworks'
    }
  });

  const markup = renderToStaticMarkup(React.createElement(PlanUnavailablePanel, {
    errorMessage: null,
    headingId: 'board-invite-heading',
    headingLevel: 'h1',
    onManualRecheck: async () => {},
    rechecking: false
  }));

  assert.match(markup, /<h1 id="board-invite-heading"/);
  assert.equal(markup.includes('<h2'), false);
});

// 共有URL（/b/{shareToken}）から入った none プランの利用者にも、
// 理由と再判定導線を出す必要がある。403 のまま放置してはならない。
test('board invite panel shows the plan gate for none-plan users', async () => {
  const source = await readFile(path.join(root, 'src/components/board-invite-panel.tsx'), 'utf8');

  assert.match(source, /PlanUnavailablePanel/);
  assert.match(source, /planCode/);
});
