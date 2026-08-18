import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

// board-list-panel.tsx のボード一覧取得effectは、開発環境ではまるごとスキップしていた
// （AuthPanelの見せかけ認証と同じ理由づけ：どうせセッションが無いから401になるだけ、という
// 前提）。auth-panel.tsx の isDev 分岐を establishDevSession で本物のセッションを張るよう
// 修正した今、この早期returnは「ボードを作成しても一覧に反映されない」という実害あるバグに
// なる（board-created イベントで refreshCount が変わっても、このeffect自体が動かない）。
test('board list fetch effect actually runs in development instead of skipping unconditionally', async () => {
  const source = await readFile(path.join(root, 'src/components/board-list-panel.tsx'), 'utf8');

  // ボード一覧取得effectを特定（sessionState?.authenticated チェック以降 refreshCount 依存配列まで）
  const boardsFetchEffect = source.match(
    /useEffect\(\(\) => \{\s*if \(!sessionState\?\.authenticated\)[\s\S]*?\}, \[page, sessionState\?\.authenticated, refreshCount, t\]\);/
  );
  assert.ok(boardsFetchEffect, 'could not locate the boards-fetching useEffect in board-list-panel.tsx');

  // ボード取得effectの先頭（認証チェック後）で開発環境を早期returnでスキップしていないこと
  assert.doesNotMatch(
    boardsFetchEffect[0],
    /NEXT_PUBLIC_ENV === 'development'\s*\)\s*\{\s*return\s*;?\s*\}/,
    '開発環境でボード一覧のfetch自体を早期returnでスキップしている。dev-sessionが本物のセッションを' +
      '張るようになった今、ボード作成後もリストが更新されない原因になる'
  );
});

// 初回アクセス時のレースコンディション防止:
// board-list-panel.tsx は開発環境で awaitDevSession() を呼び、
// dev/session 確立完了を待ってから /boards を叩くことを確認する。
test('board list awaits dev session promise before fetching boards in development', async () => {
  const source = await readFile(path.join(root, 'src/components/board-list-panel.tsx'), 'utf8');

  // awaitDevSession をインポートしていること
  assert.match(
    source,
    /import\s*\{[^}]*awaitDevSession[^}]*\}\s*from\s*'@\/lib\/session-api'/,
    'board-list-panel.tsx が awaitDevSession を session-api からインポートしていない'
  );

  // 開発環境分岐で awaitDevSession() を await していること
  assert.match(
    source,
    /NEXT_PUBLIC_ENV === 'development'[\s\S]{0,200}await awaitDevSession\(\)/,
    '開発環境で awaitDevSession() を await していない。dev/session 完了前に /boards を叩くレースコンディションが残る'
  );
});

// 401 を受け取ってもパネルが無言で消えず、エラーメッセージを表示することを確認する。
test('board list shows error message on 401 instead of silently hiding the panel', async () => {
  const source = await readFile(path.join(root, 'src/components/board-list-panel.tsx'), 'utf8');

  // /boards への fetch 後の 401 ハンドリングを対象にする（セッション確認の401とは別）
  // boards fetch effect は awaitDevSession の後にある
  const boardsFetchSection = source.match(/awaitDevSession\(\)[\s\S]*?response\.status === 401[\s\S]{0,300}/);
  assert.ok(boardsFetchSection, '/boards fetch 後の 401 ハンドリングが見つからない');

  // 401ブランチで setSessionState({authenticated: false}) を呼んでいないこと
  // (これを呼ぶとパネルがnullを返して無言で消える)
  assert.doesNotMatch(
    boardsFetchSection[0],
    /setSessionState\(\{authenticated: false\}\)/,
    '401 で setSessionState({authenticated: false}) を呼んでいる。パネルが無言で消える'
  );

  // 401ブランチでエラーメッセージをセットしていること
  assert.match(
    boardsFetchSection[0],
    /setErrorMessage\(/,
    '401 でエラーメッセージをセットしていない。利用者が状況を把握できない'
  );
});

// session-api.ts が module-level Promise を持ち、awaitDevSession() をエクスポートしていること。
test('session-api exports awaitDevSession for dev race prevention', async () => {
  const source = await readFile(path.join(root, 'src/lib/session-api.ts'), 'utf8');

  assert.match(
    source,
    /export function awaitDevSession\(\)/,
    'session-api.ts が awaitDevSession をエクスポートしていない'
  );

  // モジュールレベルの Promise 変数があること
  assert.match(
    source,
    /_devSessionPromise/,
    'session-api.ts にモジュールレベルのdev session Promise変数がない'
  );

  // establishDevSession が Promise をキャッシュして2回以上呼ばれても再実行しないこと
  assert.match(
    source,
    /_devSessionPromise !== null/,
    'establishDevSession が Promise をキャッシュしていない（初回のみ実行の保証がない）'
  );
});
