import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

// 検査対象のセレクタとメディアクエリ条件。CSS 側の記述と 1 文字でもずれたら
// テストが「見つからない」で落ちるように、文字列はここに集約する。
const STYLESHEET = 'src/app/globals.css';
const SELECTOR = {
  boardShell: '.home-shell:has(.board-canvas-shell)',
  boardShellWithBanner: '.home-shell:has(.board-canvas-shell):has(.board-join-success)',
  canvasShell: '.board-canvas-shell',
  canvasBody: '.board-canvas-body',
  stage: '.board-stage',
  constrainedStage: '.home-shell:has(.board-canvas-shell) .board-stage',
  sidebar: '.board-sidebar',
  sidebarPanels: '.board-quest-panel, .board-minimap, .board-details'
};
// 高さ制約を解除してよいのはモバイル幅の 1 分岐だけ。ここを増やすと
// デスクトップの低いビューポートでキャンバスが潰れる（Issue #94 の回帰）。
const MOBILE_MEDIA = '(max-width: 960px)';

// セレクタ抽出は直前の文字（`}` `;` または先頭）を手がかりにするため、
// コメントが残っているとその手がかりが崩れる。解析前に必ず剥がす。
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

async function readStylesheet(relativePath) {
  return stripComments(await readFile(path.join(root, relativePath), 'utf8'));
}

function escapeSelector(selector) {
  return selector.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// `@media` ブロックをトップレベルの規則から切り離す。
// これを分けないと、同じセレクタがメディアクエリ内で真逆の値
// （`height: auto` 等）を持つため、どちらを検査しているのか保証できない。
function splitTopLevelAndMedia(css) {
  const topLevelChunks = [];
  const mediaBlocks = new Map();
  let cursor = 0;

  while (cursor < css.length) {
    const atMedia = css.indexOf('@media', cursor);
    if (atMedia === -1) {
      topLevelChunks.push(css.slice(cursor));
      break;
    }

    topLevelChunks.push(css.slice(cursor, atMedia));

    const blockStart = css.indexOf('{', atMedia);
    if (blockStart === -1) throw new Error(`@media の開き波括弧が見つかりません: ${css.slice(atMedia, atMedia + 40)}`);
    const condition = css.slice(atMedia + '@media'.length, blockStart).trim();

    let depth = 0;
    let scan = blockStart;
    for (; scan < css.length; scan += 1) {
      if (css[scan] === '{') depth += 1;
      else if (css[scan] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`@media ${condition} が閉じていません`);

    mediaBlocks.set(condition, css.slice(blockStart + 1, scan));
    cursor = scan + 1;
  }

  return {topLevel: topLevelChunks.join(''), mediaBlocks};
}

// 指定セレクタの宣言ブロックを取り出す。同じスコープ内に同一セレクタが
// 複数あると、どれが有効か不定になるため一致は 1 件に限定する。
function declarationsOf(css, selector) {
  const escaped = escapeSelector(selector.trim())
    .replace(/\s*,\s*/g, '\\s*,\\s*')
    .replace(/ +/g, '\\s+');

  const pattern = new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^{}]*)\\}`, 'g');
  const matches = [...css.matchAll(pattern)];
  if (matches.length === 0) throw new Error(`セレクタが見つかりません: ${selector}`);
  if (matches.length > 1) throw new Error(`セレクタが同一スコープに ${matches.length} 件あります: ${selector}`);
  return matches[0][1];
}

function selectorsIn(css) {
  return [...css.matchAll(/(?:^|[};])\s*([^{};]+?)\s*\{/g)].map((matched) => matched[1].trim());
}

test('ボードキャンバスはビューポートに収まり、サイドバーの各パネルが個別にスクロールする', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));

  const boardShell = declarationsOf(topLevel, SELECTOR.boardShell);
  assert.match(boardShell, /height: 100dvh;/);
  assert.match(boardShell, /box-sizing: border-box;/);
  assert.match(boardShell, /overflow: hidden;/);
  assert.match(boardShell, /grid-template-rows: minmax\(0, 1fr\);/);

  assert.match(declarationsOf(topLevel, SELECTOR.boardShellWithBanner), /grid-template-rows: auto minmax\(0, 1fr\);/);

  const canvasShell = declarationsOf(topLevel, SELECTOR.canvasShell);
  assert.match(canvasShell, /height: 100%;/);
  assert.match(canvasShell, /grid-template-rows: auto minmax\(0, 1fr\);/);

  assert.match(declarationsOf(topLevel, SELECTOR.canvasBody), /min-height: 0;/);
  assert.match(declarationsOf(topLevel, SELECTOR.sidebar), /min-height: 0;/);

  const sidebarPanels = declarationsOf(topLevel, SELECTOR.sidebarPanels);
  assert.match(sidebarPanels, /min-height: 0;/);
  assert.match(sidebarPanels, /overflow: auto;/);
});

test('高さ制約の解除はモバイル幅の分岐だけに限定され、そこでは .board-stage の最低高さが戻る', async () => {
  const {topLevel, mediaBlocks} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));

  // .board-scene は position: absolute; inset: 0 なので .board-stage には内在高さがない。
  // トップレベルで min-height を 0 にできるのは、100dvh 制約が行高さを与えているからで、
  // 制約を外すメディアクエリは必ず最低高さを戻さなければならない。
  assert.match(declarationsOf(topLevel, SELECTOR.stage), /min-height: 0;/);

  const releasingMedia = [...mediaBlocks.entries()]
    .filter(([, block]) => selectorsIn(block).includes(SELECTOR.boardShell))
    .map(([condition]) => condition);
  assert.deepEqual(
    releasingMedia,
    [MOBILE_MEDIA],
    `高さ制約を解除してよいのは ${MOBILE_MEDIA} だけです（実際: ${releasingMedia.join(' / ') || 'なし'}）`
  );

  const mobile = mediaBlocks.get(MOBILE_MEDIA);
  assert.ok(mobile, `${MOBILE_MEDIA} のメディアクエリが見つかりません`);

  const mobileShell = declarationsOf(mobile, SELECTOR.boardShell);
  assert.match(mobileShell, /height: auto;/);
  assert.match(mobileShell, /overflow: visible;/);

  assert.match(declarationsOf(mobile, SELECTOR.constrainedStage), /min-height: 36rem;/);
});
