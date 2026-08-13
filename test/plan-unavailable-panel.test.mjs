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

const X_AUTH_MOCK = {
  buildXProfileUrl: (handle) => `https://x.com/${handle}`
};

async function renderPanel(props = {}) {
  const {default: PlanUnavailablePanel} = await loadModule(PANEL_PATH, {'@/lib/x-auth': X_AUTH_MOCK});

  return renderToStaticMarkup(React.createElement(PlanUnavailablePanel, {
    errorMessage: null,
    followTargetHandle: 'rictaworks',
    headingId: 'board-create-heading',
    headingLevel: 'h2',
    onManualRecheck: async () => {},
    rechecking: false,
    ...props
  }));
}

// Issue #133 の受け入れ要件は「フォロー案内」を求めている。どのアカウントを
// フォローすればよいのか示されていなければ案内として成立しないため、
// ハンドル名とプロフィールへのリンクの両方を必須とする。
test('plan unavailable panel names the follow target and links to its profile', async () => {
  const markup = await renderPanel();

  assert.match(markup, /@rictaworks/);
  assert.match(markup, /href="https:\/\/x\.com\/rictaworks"/);
  assert.match(markup, /rel="[^"]*noopener[^"]*"/);
  assert.match(markup, /target="_blank"/);
});

// globals.css の `a { color: inherit; text-decoration: none; }` により、素の <a> は
// 本文と見分けがつかない。この画面はフォローへ誘導することが唯一の出口なので、
// 案内リンクは board-create-panel.tsx のログイン導線と同じボタン表現に揃える。
test('plan unavailable panel presents the follow link as a button, not as body text', async () => {
  const markup = await renderPanel();

  assert.match(markup, /<a[^>]*class="button button-secondary auth-button"[^>]*href="https:\/\/x\.com\/rictaworks"/);
});

// 環境変数の読み取りをレンダー本体で行うと、未設定時の例外を呼び出し側の try/catch で
// 捕まえられない。src/app に error.tsx が無いため、none プランの利用者にだけ
// ページ全体が壊れて出る。ハンドルは解決済みの値を受け取る。
test('plan unavailable panel does not read the environment while rendering', async () => {
  const source = await readFile(path.join(root, PANEL_PATH), 'utf8');

  assert.equal(source.includes('readFollowTargetHandle'), false);

  const markup = await renderPanel({followTargetHandle: 'someone-else'});

  assert.match(markup, /@someone-else/);
});

// 呼び出し側で「ハンドルが取れたときだけ利用不可画面を出す」と書くと、環境変数の
// 設定漏れがそのまま機能の露出になる。ハンドルが無くてもゲートは閉じたままにし、
// 「誰をフォローすればよいか分からない案内」は出さずにエラーを見せる。
test('plan unavailable panel keeps the gate closed when the follow target is unresolved', async () => {
  const markup = await renderPanel({
    errorMessage: 'NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE is required',
    followTargetHandle: null
  });

  assert.match(markup, /unavailableHeading/);
  assert.match(markup, /NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE is required/);
  assert.equal(markup.includes('<a'), false);
  assert.equal(markup.includes('@null'), false);
  assert.equal(markup.includes('unavailableFollowGuide'), false);
});

// 親セクションが aria-labelledby でこのIDを参照するため、見出しが無いと
// 参照先が存在しないIDになり、スクリーンリーダーでセクション名が失われる。
test('plan unavailable panel renders a heading with the id its parent references', async () => {
  const markup = await renderPanel();

  assert.match(markup, /<h2 id="board-create-heading"/);
});

// 共有URLのページはページレベルの h1 を持たず、各分岐が自前で h1 を出している。
// このパネルだけ h2 固定にすると、none プランの利用者には h1 の無いページが出る。
test('plan unavailable panel follows the heading level its page needs', async () => {
  const markup = await renderPanel({headingId: 'board-invite-heading', headingLevel: 'h1'});

  assert.match(markup, /<h1 id="board-invite-heading"/);
  assert.equal(markup.includes('<h2'), false);
});

// 環境変数の解決を親へ移すと、解決に失敗したまま利用不可画面へ進む経路が生まれ得る。
// 「誰をフォローすればよいか分からない案内」を出さないため、両親はハンドルを
// セッション読み込みと同じ try/catch の中で解決し、prop として渡す。
test('both gate hosts resolve the follow target outside render and pass it down', async () => {
  for (const host of ['src/components/board-create-panel.tsx', 'src/components/board-invite-panel.tsx']) {
    const source = await readFile(path.join(root, host), 'utf8');

    assert.match(source, /readFollowTargetHandle/, `${host} がフォロー対象を解決していない`);
    assert.match(source, /followTargetHandle=\{/, `${host} が followTargetHandle を渡していない`);
  }
});

// 共有URL（/b/{shareToken}）から入った none プランの利用者にも、
// 理由と再判定導線を出す必要がある。403 のまま放置してはならない。
test('board invite panel shows the plan gate for none-plan users', async () => {
  const source = await readFile(path.join(root, 'src/components/board-invite-panel.tsx'), 'utf8');

  assert.match(source, /PlanUnavailablePanel/);
  assert.match(source, /planCode/);
});
