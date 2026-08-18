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
