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

  const boardsFetchEffect = source.match(
    /useEffect\(\(\) => \{\s*if \(!sessionState\?\.authenticated\)[\s\S]*?\}, \[page, sessionState\?\.authenticated, refreshCount, t\]\);/
  );
  assert.ok(boardsFetchEffect, 'could not locate the boards-fetching useEffect in board-list-panel.tsx');

  assert.doesNotMatch(
    boardsFetchEffect[0],
    /NEXT_PUBLIC_ENV === 'development'/,
    '開発環境でボード一覧のfetch自体を早期returnでスキップしている。dev-sessionが本物のセッションを' +
      '張るようになった今、ボード作成後もリストが更新されない原因になる'
  );
});

// issue #194: 初回アクセス（Cookieなし）では、auth-panel の establishDevSession が
// Cookie を張り終わる前にこの effect の GET /boards が走って 401 になり、パネルが
// エラー表示も無く消えるレースがあった。認証必須 fetch の前に waitForDevSession で
// 共有 dev セッションの解決を待つことを固定する。
test('board list fetch waits for the shared dev session before requesting /boards', async () => {
  const source = await readFile(path.join(root, 'src/components/board-list-panel.tsx'), 'utf8');

  const boardsFetchEffect = source.match(
    /useEffect\(\(\) => \{\s*if \(!sessionState\?\.authenticated\)[\s\S]*?\}, \[page, sessionState\?\.authenticated, refreshCount, t\]\);/
  );
  assert.ok(boardsFetchEffect, 'could not locate the boards-fetching useEffect in board-list-panel.tsx');

  const effect = boardsFetchEffect[0];
  const waitIndex = effect.indexOf('await waitForDevSession(');
  const fetchIndex = effect.indexOf('/boards?page=');

  assert.ok(waitIndex !== -1, 'boards fetch effect が waitForDevSession を待っていない（401レースが再発する）');
  assert.ok(fetchIndex !== -1, 'boards fetch の URL が見つからない');
  assert.ok(waitIndex < fetchIndex, 'waitForDevSession は GET /boards より前に待つ必要がある');
});

// issue #194 受け入れ要件：開発環境で /boards が 401 を返した場合、パネルを無言で
// null にせず、エラー表示に倒して状況を追跡可能にする。本番の 401 は従来どおり
// 「未ログイン」としてパネルを隠す（sessionState を false へ）。
test('board list surfaces a visible error on 401 in development instead of vanishing silently', async () => {
  const source = await readFile(path.join(root, 'src/components/board-list-panel.tsx'), 'utf8');

  const boardsFetchEffect = source.match(
    /useEffect\(\(\) => \{\s*if \(!sessionState\?\.authenticated\)[\s\S]*?\}, \[page, sessionState\?\.authenticated, refreshCount, t\]\);/
  );
  assert.ok(boardsFetchEffect, 'could not locate the boards-fetching useEffect in board-list-panel.tsx');

  const unauthorizedBranch = boardsFetchEffect[0].match(/if \(response\.status === 401\) \{[\s\S]*?\n {8}\}/);
  assert.ok(unauthorizedBranch, 'could not locate the 401 branch in the boards fetch effect');

  assert.match(
    unauthorizedBranch[0],
    /isDevEnvironment/,
    '401 branch が開発環境を区別していない（開発では無言でパネルが消える退行になる)'
  );
  assert.match(
    unauthorizedBranch[0],
    /throw new Error/,
    '開発環境の 401 がエラー表示に到達しない（catch で setErrorMessage される経路が必要）'
  );
});
