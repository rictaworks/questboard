import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

// 検査対象のセレクタとメディアクエリ条件。CSS 側の記述と 1 文字でもずれたら
// テストが「見つからない」で落ちるように、文字列はここに集約する。
const STYLESHEET = 'src/app/globals.css';
const CANVAS_COMPONENT = 'src/components/board-canvas-panel.tsx';
const SELECTOR = {
  boardShell: '.home-shell:has(.board-canvas-shell)',
  boardShellWithBanner: '.home-shell:has(.board-canvas-shell):has(.board-join-success)',
  canvasShell: '.board-canvas-shell',
  canvasBody: '.board-canvas-body',
  constrainedCanvasBody: '.home-shell:has(.board-canvas-shell) .board-canvas-body',
  stage: '.board-stage',
  constrainedStage: '.home-shell:has(.board-canvas-shell) .board-stage',
  sidebar: '.board-sidebar',
  sidebarPanels: '.board-minimap, .board-details, .board-quest-panel',
  minimapSurface: '.board-minimap-surface'
};
// 高さ制約を解除してよいのはモバイル幅の 1 分岐だけ。ここを増やすと
// デスクトップの低いビューポートでキャンバスが潰れる（Issue #94 の回帰）。
const MOBILE_MEDIA = '(max-width: 960px)';
// サイドバー各パネルの下限。ビューポートが低いと 1 行分まで潰れて実質操作
// できなくなるため、下限を割ったらサイドバーごとスクロールさせる。
const PANEL_MIN_HEIGHT = '8rem';
// ミニマップ盤面は、縦幅が十分にある通常表示では俯瞰性を優先して固定下限を
// 保つ。幅に追従する可変化（aspect-ratio）は、入れ子スクロールが実際に問題
// になる低いビューポート（LOW_HEIGHT_MEDIA）だけに限定する。
const MINIMAP_SURFACE_MIN_HEIGHT = '10rem';
const MINIMAP_ASPECT_RATIO = '5 / 1';
// 縦が窮屈なときだけ、クエストと詳細パネルの下限を少し緩める。
const LOW_HEIGHT_MEDIA = '(max-height: 820px)';
// 高さ制約を外すモバイル分岐でステージに戻す最低高さ。
const STAGE_MIN_HEIGHT = '36rem';

// セレクタ抽出は直前の文字（`}` `;` または先頭）を手がかりにするため、
// コメントが残っているとその手がかりが崩れる。解析前に必ず剥がす。
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

async function readStylesheet(relativePath) {
  return stripComments(await readFile(path.join(root, relativePath), 'utf8'));
}

// 対応する閉じ波括弧の位置を返す。`@keyframes` のように入れ子を持つ
// ブロックがあるため、単純な `indexOf('}')` では切り出せない。
function findBlockEnd(css, blockStart) {
  let depth = 0;

  for (let scan = blockStart; scan < css.length; scan += 1) {
    if (css[scan] === '{') depth += 1;
    else if (css[scan] === '}') {
      depth -= 1;
      if (depth === 0) return scan;
    }
  }

  throw new Error(`ブロックが閉じていません: ${css.slice(blockStart, blockStart + 40)}`);
}

// at-rule をトップレベルの規則から切り離す。
// `@media` を分けないと、同じセレクタがメディアクエリ内で真逆の値
// （`height: auto` 等）を持つため、どちらを検査しているのか保証できない。
// `@import`（ブロック無し）や `@keyframes`（入れ子あり）を残すと、
// 後段の規則パースがセレクタ境界を見失うので同時に取り除く。
function splitTopLevelAndMedia(css) {
  const topLevelChunks = [];
  const mediaBlocks = new Map();
  let cursor = 0;

  // `@` は宣言値（`content: "@"` や url 内）にも現れうるので、行頭の `@` だけを
  // at-rule の開始とみなす。
  const atRulePattern = /(?:^|\n)[ \t]*@/g;

  while (cursor < css.length) {
    atRulePattern.lastIndex = cursor;
    const found = atRulePattern.exec(css);
    if (!found) {
      topLevelChunks.push(css.slice(cursor));
      break;
    }
    const atRule = found.index + found[0].length - 1;

    topLevelChunks.push(css.slice(cursor, atRule));

    const blockStart = css.indexOf('{', atRule);
    const statementEnd = css.indexOf(';', atRule);
    // `@import ...;` のようにブロックを持たない at-rule は行ごと捨てる。
    if (blockStart === -1 || (statementEnd !== -1 && statementEnd < blockStart)) {
      if (statementEnd === -1) throw new Error(`at-rule が終端していません: ${css.slice(atRule, atRule + 40)}`);
      cursor = statementEnd + 1;
      continue;
    }

    const prelude = css.slice(atRule, blockStart);
    const blockEnd = findBlockEnd(css, blockStart);
    if (prelude.trimStart().startsWith('@media')) {
      mediaBlocks.set(prelude.slice(prelude.indexOf('@media') + '@media'.length).trim(), css.slice(blockStart + 1, blockEnd));
    }
    cursor = blockEnd + 1;
  }

  return {topLevel: topLevelChunks.join(''), mediaBlocks};
}

// セレクタ群を「並び順と空白に依存しない」キーに正規化する。
// 整形やセレクタの並べ替えだけでテストが落ちると、挙動不変の変更まで
// ブロックされてしまうため、比較対象は意味のある単位だけに絞る。
function selectorKey(selector) {
  return selector
    .split(',')
    .map((part) => part.trim().replace(/\s+/g, ' '))
    .sort()
    .join(',');
}

function normalizeValue(value) {
  return value.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
}

// スコープ内の全規則を「正規化セレクタ → 宣言 Map」の索引にする。
// 同一セレクタが 2 回現れると後勝ちで挙動が読めなくなるため出現数も持つ。
function indexRules(css) {
  const index = new Map();

  // at-rule 除去済みの平坦な `セレクタ { 宣言 }` 列を前提に走査する。
  // 直前の `}` を手がかりにすると、その `}` を消費して次の規則を
  // 取りこぼす（1 つおきに見えなくなる）ので、括弧以外の連なりで区切る。
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = selectorKey(rule[1]);
    const declarations = new Map();

    for (const declaration of rule[2].split(';')) {
      const separator = declaration.indexOf(':');
      if (separator === -1) continue;
      declarations.set(declaration.slice(0, separator).trim(), normalizeValue(declaration.slice(separator + 1)));
    }

    const existing = index.get(key);
    index.set(key, {declarations, count: existing ? existing.count + 1 : 1});
  }

  return index;
}

// 宣言を取り出す。同一スコープに同じセレクタが重複していたら、
// どちらが効くか読めないので明示的に失敗させる。
function declarationsOf(index, selector) {
  const found = index.get(selectorKey(selector));
  if (!found) throw new Error(`セレクタが見つかりません: ${selector}`);
  if (found.count > 1) throw new Error(`セレクタが同一スコープに ${found.count} 件あります: ${selector}`);
  return found.declarations;
}

function assertDeclaration(index, selector, property, expected) {
  const actual = declarationsOf(index, selector).get(property);
  assert.equal(actual, expected, `${selector} の ${property} が想定と異なります（実際: ${actual ?? 'なし'}）`);
}

test('ボードキャンバスはビューポートに収まり、サイドバーの各パネルが個別にスクロールする', async () => {
  const {topLevel, mediaBlocks} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.boardShell, 'height', '100dvh');
  assertDeclaration(rules, SELECTOR.boardShell, 'overflow', 'hidden');
  assertDeclaration(rules, SELECTOR.boardShell, 'grid-template-rows', 'minmax(0, 1fr)');
  // `* { box-sizing: border-box }` が全体に効いているので再指定しない。
  // 冗長な宣言をテストで固定すると、後から消せなくなる。
  assert.equal(
    declarationsOf(rules, SELECTOR.boardShell).has('box-sizing'),
    false,
    'box-sizing はグローバルの `*` 指定と重複するため書かない'
  );

  assertDeclaration(rules, SELECTOR.boardShellWithBanner, 'grid-template-rows', 'auto minmax(0, 1fr)');

  assertDeclaration(rules, SELECTOR.canvasShell, 'height', '100%');
  assertDeclaration(rules, SELECTOR.canvasShell, 'grid-template-rows', 'auto minmax(0, 1fr)');

  assertDeclaration(rules, SELECTOR.canvasBody, 'min-height', STAGE_MIN_HEIGHT);
  assertDeclaration(rules, SELECTOR.constrainedCanvasBody, 'min-height', '0');
  assertDeclaration(rules, SELECTOR.stage, 'min-height', STAGE_MIN_HEIGHT);
  assertDeclaration(rules, SELECTOR.constrainedStage, 'min-height', '0');
  assertDeclaration(rules, SELECTOR.sidebar, 'min-height', '0');

  assertDeclaration(rules, SELECTOR.sidebarPanels, 'overflow', 'auto');
  // overscroll-behavior: contain は付けない。.board-stage はパネルの祖先ではなく
  // 兄弟なのでキャンバスへは元々連鎖せず、逆にパネル末端から .board-sidebar への
  // ホイール伝播を止めてしまい、サイドバーがスクロールできなくなる。
  assert.equal(
    declarationsOf(rules, SELECTOR.sidebarPanels).has('overscroll-behavior'),
    false,
    'overscroll-behavior はサイドバーへのスクロール伝播を止めるため指定しない'
  );
});

test('パネルは下限高さを持ち、収まらない場合はサイドバーごとスクロールする', async () => {
  const {topLevel, mediaBlocks} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  // 下限が無いと、低いビューポートで各パネルが 1 行分（約 50px）まで潰れ、
  // `overflow: hidden` の .home-shell 内なので逃げ道が無くなる。
  assertDeclaration(rules, SELECTOR.sidebarPanels, 'min-height', PANEL_MIN_HEIGHT);
  // 下限の合計がサイドバーを超えたときの受け皿。
  assertDeclaration(rules, SELECTOR.sidebar, 'overflow', 'auto');

  // 通常表示（縦幅が十分にある）では、ミニマップ盤面は俯瞰性を優先して高さを
  // 固定し、幅に追従する aspect-ratio はまだ効かせない。
  assertDeclaration(rules, SELECTOR.minimapSurface, 'height', MINIMAP_SURFACE_MIN_HEIGHT);
  assert.equal(
    declarationsOf(rules, SELECTOR.minimapSurface).has('min-height'),
    false,
    '通常表示では高さ固定とするため、min-height は指定しません'
  );
  assert.equal(
    declarationsOf(rules, SELECTOR.minimapSurface).has('aspect-ratio'),
    false,
    '通常表示では固定高さを使うため、aspect-ratio はまだ指定しません'
  );
  // 親パネル .board-minimap も、通常表示の固定高盤面をクリップせずに収められる
  // 最小高さを確保する。
  assertDeclaration(rules, '.board-minimap', 'min-height', '15rem');

  const lowHeight = mediaBlocks.get(LOW_HEIGHT_MEDIA);
  assert.ok(lowHeight, `${LOW_HEIGHT_MEDIA} のメディアクエリが見つかりません`);
  const lowHeightRules = indexRules(lowHeight);
  assertDeclaration(lowHeightRules, SELECTOR.sidebarPanels, 'min-height', '5.5rem');

  // 低いビューポートでは、固定下限がサイドバー全体の入れ子スクロールを
  // 引き起こすため、ここでだけ幅に追従する可変盤面へ切り替える。
  assertDeclaration(lowHeightRules, SELECTOR.minimapSurface, 'min-height', '0');
  assertDeclaration(lowHeightRules, SELECTOR.minimapSurface, 'aspect-ratio', MINIMAP_ASPECT_RATIO);
});

// スクロール領域をキーボードで到達できるようにするための属性。Chrome は
// スクロールコンテナを自動でフォーカス可能にするが、Firefox / Safari はしない。
const PANEL_CLASSES = ['board-quest-panel', 'board-minimap', 'board-details'];

function openingTagOf(source, className) {
  const pattern = new RegExp(`<section[^>]*className="${className}"[^>]*>`);
  const matched = source.match(pattern);
  if (!matched) throw new Error(`className="${className}" の section が見つかりません`);
  return matched[0];
}

test('スクロールするサイドバーパネルはキーボードで到達でき、名前を持つ', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  for (const className of PANEL_CLASSES) {
    const tag = openingTagOf(source, className);
    assert.match(tag, /tabIndex=\{0\}/, `${className} がキーボードフォーカスを受け取れません`);
    assert.match(
      tag,
      /aria-labelledby="[^"]+"|aria-label=/,
      `${className} のスクロール領域に読み上げ用の名前がありません`
    );
  }
});

test('キャンバスのズームは初期表示だけで設定され、リセットUI がある', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');
  assert.match(source, /fitToContent\(contentBounds, viewport\)/, '初期カメラは fitToContent で決まる必要があります');
  assert.match(source, /hasAppliedInitialCameraRef/, '初期倍率の再適用を抑止するフラグが必要です');
  assert.match(source, /source: 'reset-button'/, 'ズームリセット時の追跡イベントが必要です');
  assert.match(source, /t\('resetCamera'\)/, 'ズームリセット文言がローカライズされている必要があります');
});

test('高さ制約の解除はモバイル幅の分岐だけに限定され、そこでは .board-stage の最低高さが戻る', async () => {
  const {topLevel, mediaBlocks} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));

  // .board-scene は position: absolute; inset: 0 なので .board-stage には内在高さがない。
  // 100dvh 制約が効いている文脈だけで min-height を 0 にし、非対応環境では
  // 既定の最低高さを残しておく。
  assertDeclaration(indexRules(topLevel), SELECTOR.stage, 'min-height', STAGE_MIN_HEIGHT);
  assertDeclaration(indexRules(topLevel), SELECTOR.constrainedStage, 'min-height', '0');

  const releasingMedia = [...mediaBlocks.entries()]
    .filter(([, block]) => indexRules(block).has(selectorKey(SELECTOR.boardShell)))
    .map(([condition]) => condition);
  assert.deepEqual(
    releasingMedia,
    [MOBILE_MEDIA],
    `高さ制約を解除してよいのは ${MOBILE_MEDIA} だけです（実際: ${releasingMedia.join(' / ') || 'なし'}）`
  );

  const mobile = mediaBlocks.get(MOBILE_MEDIA);
  assert.ok(mobile, `${MOBILE_MEDIA} のメディアクエリが見つかりません`);
  const mobileRules = indexRules(mobile);

  assertDeclaration(mobileRules, SELECTOR.boardShell, 'height', 'auto');
  assertDeclaration(mobileRules, SELECTOR.boardShell, 'overflow', 'visible');

  // メディアクエリは詳細度を上げない。バナー版（:has が 1 つ多い）を書き漏らすと
  // トップレベルの `auto minmax(0, 1fr)` が勝ち、この宣言は死ぬ。
  assertDeclaration(mobileRules, SELECTOR.boardShell, 'grid-template-rows', 'auto');
  assertDeclaration(mobileRules, SELECTOR.boardShellWithBanner, 'grid-template-rows', 'auto');

  assertDeclaration(mobileRules, SELECTOR.constrainedStage, 'min-height', STAGE_MIN_HEIGHT);

  assertDeclaration(mobileRules, SELECTOR.minimapSurface, 'min-height', '0');
  assertDeclaration(mobileRules, SELECTOR.minimapSurface, 'height', 'auto');
  assertDeclaration(mobileRules, SELECTOR.minimapSurface, 'aspect-ratio', MINIMAP_ASPECT_RATIO);
  assertDeclaration(mobileRules, '.board-minimap', 'min-height', 'auto');
});
