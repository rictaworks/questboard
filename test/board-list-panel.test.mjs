import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

async function readBoardsFetchEffect() {
  const source = await readFile(path.join(root, 'src/components/board-list-panel.tsx'), 'utf8');

  const boardsFetchEffect = source.match(
    /useEffect\(\(\) => \{\s*if \(!sessionState\?\.authenticated\)[\s\S]*?\}, \[page, sessionState\?\.authenticated, refreshCount, authT, t\]\);/
  );
  assert.ok(boardsFetchEffect, 'could not locate the boards-fetching useEffect in board-list-panel.tsx');
  return boardsFetchEffect[0];
}

// board-list-panel.tsx のボード一覧取得effectは、開発環境ではまるごとスキップしていた
// （AuthPanelの見せかけ認証と同じ理由づけ：どうせセッションが無いから401になるだけ、という
// 前提）。auth-panel.tsx の isDev 分岐が本物のセッションを張るようになった今、この早期returnは
// 「ボードを作成しても一覧に反映されない」という実害あるバグになる（board-created イベントで
// refreshCount が変わっても、このeffect自体が動かない）。
test('board list fetch effect actually runs in development instead of skipping unconditionally', async () => {
  const boardsFetchEffect = await readBoardsFetchEffect();

  assert.doesNotMatch(
    boardsFetchEffect,
    /NEXT_PUBLIC_ENV === 'development'/,
    '開発環境でボード一覧のfetch自体を早期returnでスキップしている。dev-sessionが本物のセッションを' +
      '張るようになった今、ボード作成後もリストが更新されない原因になる'
  );
});

// issue #194: 初回アクセス（セッションCookie未保持）では、AuthPanel の POST /dev/session と
// このeffectの GET /boards がマウント直後に同時に走り、Cookie確立前の /boards が401になって
// ボード一覧が無言で消えていた。共有devセッションの確立完了を待ってからfetchすることを固定する。
test('boards fetch waits for the shared dev session before requesting the list', async () => {
  const boardsFetchEffect = await readBoardsFetchEffect();

  const waitIndex = boardsFetchEffect.indexOf('await waitForDevSession(');
  const fetchIndex = boardsFetchEffect.indexOf('await fetch(');

  assert.notEqual(waitIndex, -1, '/boards のfetch前に waitForDevSession で devセッション確立を待っていない');
  assert.notEqual(fetchIndex, -1, 'could not locate the boards fetch call in the effect');
  assert.ok(
    waitIndex < fetchIndex,
    'waitForDevSession が fetch の後に置かれている。Cookie確立前に /boards が飛ぶレース（issue #194）が残る'
  );
});

// issue #194 受け入れ要件: devセッション確立後の401は想定外の異常。authenticated:false に
// 倒すとパネルが return null で無言で消え、エラーも出ずデバッグ不能になる。開発環境では
// エラー表示に倒し、利用者（開発者）が状況を把握できることを固定する。
test('a development 401 surfaces an error instead of silently hiding the panel', async () => {
  const boardsFetchEffect = await readBoardsFetchEffect();

  assert.match(
    boardsFetchEffect,
    /status === 401\) \{\s*if \(isDevelopmentEnvironment\(\)\) \{[^}]*throw new Error/,
    '開発環境の401がエラー表示にならず、authenticated:false でパネルを無言で消している'
  );
});
