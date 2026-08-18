import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

// 検査対象のセレクタとメディアクエリ条件。CSS 側の記述と 1 文字でもずれたら
// テストが「見つからない」で落ちるように、文字列はここに集約する。
const STYLESHEET = 'src/app/globals.css';
const CANVAS_COMPONENT = 'src/components/board-canvas-panel.tsx';
const TOP_BAR_COMPONENT = 'src/components/board-top-bar.tsx';
const QUEST_SIDEBAR_COMPONENT = 'src/components/board-quest-sidebar.tsx';
const RADIAL_MENU_COMPONENT = 'src/components/board-radial-menu.tsx';
const SELECTOR = {
  boardShell: '.home-shell:has(.board-canvas-shell)',
  boardShellWithBanner: '.home-shell:has(.board-canvas-shell):has(.board-join-success)',
  boardShellFallback: '.home-shell:has(.board-canvas-shell) .board-canvas-shell',
  canvasShell: '.board-canvas-shell',
  topBar: '.board-top-bar',
  body: '.board-canvas-body',
  questSidebar: '.board-quest-sidebar',
  stageArea: '.board-stage-area',
  stage: '.board-stage',
  minimapFixed: '.board-minimap-fixed',
  minimapSurface: '.board-minimap-surface',
  panelOverlay: '.board-canvas-panel-overlay',
  details: '.board-details',
  radialBackdrop: '.board-radial-backdrop',
  radialItem: '.board-radial-item',
  userMenu: '.board-user-menu',
  userMenuTrigger: '.board-user-menu-trigger',
  userMenuAvatar: '.board-user-menu-avatar',
  userMenuPanel: '.board-user-menu-panel',
  footer: '.site-footer',
  boardFooter: 'body:has(.board-canvas-shell) .site-footer',
  footerDisclosure: '.site-footer-disclosure',
  footerTrigger: '.site-footer-trigger',
  footerPanel: '.site-footer-disclosure[open] > .site-footer-panel',
  toasts: '.board-toasts'
};

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

// ── issue #192: モック（app-ui/Questboard Prototype.dc.html）準拠レイアウト ──

test('シェルは上部バー＋本体の縦積みで、ページ全体はスクロールしない', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.boardShell, 'height', '100%');
  assertDeclaration(rules, SELECTOR.boardShell, 'width', '100%');
  assertDeclaration(rules, SELECTOR.boardShell, 'max-width', 'none');
  assertDeclaration(rules, SELECTOR.boardShell, 'margin', '0');
  assertDeclaration(rules, SELECTOR.boardShell, 'padding', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.boardShell, 'overflow', 'hidden');
  assertDeclaration(rules, SELECTOR.boardShell, 'grid-template-rows', 'minmax(0, 1fr)');

  assertDeclaration(rules, SELECTOR.boardShellWithBanner, 'grid-template-rows', 'auto minmax(0, 1fr)');

  // :has() 非対応環境向けフォールバック。対応環境ではこの直後の規則が 0 に上書きする。
  assertDeclaration(rules, SELECTOR.canvasShell, 'min-height', '36rem');
  assertDeclaration(rules, SELECTOR.boardShellFallback, 'min-height', '0');

  // シェルは flex 縦積み（上部バー＋本体）。
  assertDeclaration(rules, SELECTOR.canvasShell, 'display', 'flex');
  assertDeclaration(rules, SELECTOR.canvasShell, 'flex-direction', 'column');
  assertDeclaration(rules, SELECTOR.canvasShell, 'height', '100%');
  assertDeclaration(rules, SELECTOR.canvasShell, 'overflow', 'hidden');
});

test('上部バーはモックの 64px バーで、本体はサイドバー＋キャンバスの横並び', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.topBar, 'height', '4rem');
  assertDeclaration(rules, SELECTOR.topBar, 'flex-shrink', '0');
  assertDeclaration(rules, SELECTOR.topBar, 'display', 'flex');
  assertDeclaration(rules, SELECTOR.topBar, 'align-items', 'center');

  assertDeclaration(rules, SELECTOR.body, 'flex', '1');
  assertDeclaration(rules, SELECTOR.body, 'display', 'flex');
  assertDeclaration(rules, SELECTOR.body, 'min-height', '0');

  // クエストサイドバーは常設（モックの 288px 相当）で、内部スクロールする。
  assertDeclaration(rules, SELECTOR.questSidebar, 'width', '18rem');
  assertDeclaration(rules, SELECTOR.questSidebar, 'flex-shrink', '0');
  assertDeclaration(rules, SELECTOR.questSidebar, 'overflow-y', 'auto');

  // キャンバスは残り幅いっぱいに絶対配置で広がる。
  assertDeclaration(rules, SELECTOR.stageArea, 'position', 'relative');
  assertDeclaration(rules, SELECTOR.stageArea, 'flex', '1');
  assertDeclaration(rules, SELECTOR.stageArea, 'min-width', '0');
  assertDeclaration(rules, SELECTOR.stage, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.stage, 'inset', '0');
  assert.equal(
    declarationsOf(rules, SELECTOR.stage).has('min-height'),
    false,
    '.board-stage は絶対配置で親いっぱいに広がるため min-height を持たない'
  );
});

test('ミニマップはキャンバス右下の固定パネル（トグル廃止）', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.minimapFixed, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.minimapFixed, 'right', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.minimapFixed, 'bottom', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.minimapFixed, 'width', '12.5rem');
  assertDeclaration(rules, SELECTOR.minimapFixed, 'height', '8.75rem');
  assertDeclaration(rules, SELECTOR.minimapFixed, 'overflow', 'hidden');

  assertDeclaration(rules, SELECTOR.minimapSurface, 'height', '100%');
  assert.equal(
    declarationsOf(rules, SELECTOR.minimapSurface).has('aspect-ratio'),
    false,
    '盤面は常に親グリッド行いっぱいに広がるため aspect-ratio 切り替えは不要'
  );
});

test('詳細パネルだけがオーバーレイとして上部バーの下に開く', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.panelOverlay, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.panelOverlay, 'top', 'calc(4rem + var(--space-3))');
  assertDeclaration(rules, SELECTOR.panelOverlay, 'right', 'var(--space-3)');
  assertDeclaration(rules, SELECTOR.panelOverlay, 'bottom', 'var(--space-3)');
  assertDeclaration(rules, SELECTOR.panelOverlay, 'width', '22rem');

  // パネル自身は overlay 側が高さを確定させるため min-height を持たず、
  // overflow: auto で内部スクロールする。
  assertDeclaration(rules, SELECTOR.details, 'overflow', 'auto');
  assert.equal(
    declarationsOf(rules, SELECTOR.details).has('min-height'),
    false,
    'パネルの高さは .board-canvas-panel-overlay の top/bottom が決めるため min-height は不要'
  );

  assertDeclaration(rules, SELECTOR.userMenu, 'position', 'relative');
  assertDeclaration(rules, SELECTOR.userMenuTrigger, 'display', 'inline-flex');
  assertDeclaration(rules, SELECTOR.userMenuAvatar, 'width', '2rem');
  assertDeclaration(rules, SELECTOR.userMenuPanel, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.userMenuPanel, 'top', 'calc(100% + var(--space-2))');
});

test('ラジアルメニューは fixed 配置の円形ボタン群', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.radialBackdrop, 'position', 'fixed');
  assertDeclaration(rules, SELECTOR.radialBackdrop, 'inset', '0');
  assertDeclaration(rules, SELECTOR.radialItem, 'position', 'fixed');
  assertDeclaration(rules, SELECTOR.radialItem, 'width', '3.5rem');
  assertDeclaration(rules, SELECTOR.radialItem, 'height', '3.5rem');
  assertDeclaration(rules, SELECTOR.radialItem, 'border-radius', '999px');
});

test('フッターはミニマップの左隣に寄せ、トーストは左下に置く', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.footer, 'padding', 'var(--space-3) var(--space-4)');
  assertDeclaration(rules, SELECTOR.boardFooter, 'position', 'fixed');
  assertDeclaration(rules, SELECTOR.boardFooter, 'right', 'calc(var(--space-4) * 2 + 12.5rem + var(--space-3))');
  assertDeclaration(rules, SELECTOR.boardFooter, 'bottom', 'calc(var(--space-4) * 2)');
  assertDeclaration(rules, SELECTOR.footerDisclosure, 'display', 'grid');
  assertDeclaration(rules, SELECTOR.footerTrigger, 'display', 'inline-flex');
  assertDeclaration(rules, SELECTOR.footerPanel, 'display', 'grid');

  assertDeclaration(rules, SELECTOR.toasts, 'position', 'fixed');
  assertDeclaration(rules, SELECTOR.toasts, 'left', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.toasts, 'bottom', 'var(--space-4)');
});

test('ビューポート幅に応じてサイドバーを縦積みへ切り替える分岐は存在しない', async () => {
  const {mediaBlocks} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));

  const boardCanvasMediaQueries = [...mediaBlocks.entries()].filter(([, block]) => (
    /\.board-canvas-shell|\.board-quest-sidebar|\.board-stage|\.board-canvas-body|\.board-top-bar/.test(block)
  ));
  assert.deepEqual(
    boardCanvasMediaQueries.map(([condition]) => condition),
    [],
    `ボードキャンバス関連のメディアクエリ分岐が残っています: ${boardCanvasMediaQueries.map(([condition]) => condition).join(' / ')}`
  );
});

// className は他のクラスと同居するため、完全一致ではなく空白区切りのトークンとして探す。
function openingTagOf(source, tagName, className) {
  const pattern = new RegExp(`<${tagName}[^>]*className="[^"]*\\b${className}\\b[^"]*"[^>]*>`);
  const matched = source.match(pattern);
  if (!matched) throw new Error(`className に "${className}" を含む ${tagName} が見つかりません`);
  return matched[0];
}

test('詳細パネルとクエストサイドバーはキーボードで到達でき、名前を持つ', async () => {
  const panelSource = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');
  const sidebarSource = await readFile(path.join(root, QUEST_SIDEBAR_COMPONENT), 'utf8');

  const detailsTag = openingTagOf(panelSource, 'section', 'board-details');
  assert.match(detailsTag, /tabIndex=\{0\}/, 'board-details がキーボードフォーカスを受け取れません');
  assert.match(detailsTag, /aria-labelledby="[^"]+"|aria-label=/, 'board-details に読み上げ用の名前がありません');

  const sidebarTag = openingTagOf(sidebarSource, 'aside', 'board-quest-sidebar');
  assert.match(sidebarTag, /tabIndex=\{0\}/, 'board-quest-sidebar がキーボードフォーカスを受け取れません');
  assert.match(sidebarTag, /aria-label=/, 'board-quest-sidebar に読み上げ用の名前がありません');
});

test('キャンバスのズームは初期表示だけで設定され、リセットUI がある', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');
  assert.match(source, /fitToContent\(contentBounds, viewport\)/, '初期カメラは fitToContent で決まる必要があります');
  assert.match(source, /hasAppliedInitialCameraRef/, '初期倍率の再適用を抑止するフラグが必要です');
  assert.match(source, /source: 'reset-button'/, 'ズームリセット時の追跡イベントが必要です');
  assert.match(source, /t\('resetCamera'\)/, 'ズームリセット文言がローカライズされている必要があります');
});

test('オーバーレイは詳細パネル1枚だけで、レール型のパネル切替は存在しない', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  assert.match(source, /type ActivePanel = 'details' \| null;/);
  assert.doesNotMatch(source, /board-canvas-rail/, '右端コマンドレールは廃止済み（issue #192）');
  assert.doesNotMatch(source, /board-canvas-create-rail/, '左端の作成レールは廃止済み（issue #192）');
  assert.doesNotMatch(source, /board-canvas-settings-panel/, '設定パネルは上部バーへ移設済み（issue #192）');
});

test('ダブルクリック作成とラジアルメニューの intent がパネルに配線されている', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  assert.match(source, /intent\.kind === 'radial-menu' \|\| intent\.kind === 'create-note'/, '入力層の intent を UI ハンドラへ委譲していない');
  assert.match(source, /buildRadialMenuItems\(/, 'ラジアルメニュー項目はピュア関数で構築する');
  assert.match(source, /createObject\('sticky', world\)/, '空白ダブルクリックはカーソル位置に付箋を作る');
  assert.match(source, /eventId: 'radial_opened'/, 'ラジアルメニュー表示の KPI 追跡が必要');
  assert.match(source, /data-obj-id=\{object\.id\}/, 'ヒットテスト用の data-obj-id が必要');
});

test('オブジェクト選択は詳細パネルを自動で開かない', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  const selectionEffect = source.match(
    /if \(selectedObjectId !== prevSelectedObjectId\) \{[\s\S]*?\n {2}\}/
  );
  assert.ok(selectionEffect, 'could not locate the selection-tracking block in board-canvas-panel.tsx');

  assert.doesNotMatch(
    selectionEffect[0],
    /setActivePanel\('details'\)/,
    '選択のたびに詳細パネルを強制的に開いている（ラジアルメニューのコメントからだけ開くべき）'
  );
  assert.match(
    selectionEffect[0],
    /selectedObjectId == null[\s\S]*?setActivePanel\(\(current\) => \(current === 'details' \? null : current\)\)/,
    '選択が外れたときに、開いていた詳細パネルを閉じる後始末が無い'
  );
});

// ラジアルメニュー・盤面ラベルとも、バックエンドの生の code（"sticky" 等）を
// そのまま表示せず、オンボーディングクエスト（例:「付箋を3枚作る」db/seeds.rb）と
// 同じ日本語ラベル（objectType* キー）を経由することを検証する。
test('ラジアルメニューの作成項目はクエスト文言と同じ日本語ラベルキーを使う', async () => {
  const radialLibSource = await readFile(path.join(root, 'src/lib/radial-menu.ts'), 'utf8');

  assert.match(radialLibSource, /objectTypeSticky/, '付箋のラベルキーが無い');
  assert.match(radialLibSource, /objectTypeShape/);
  assert.match(radialLibSource, /objectTypeText/);
  assert.match(radialLibSource, /objectTypeFrame/);

  const radialComponentSource = await readFile(path.join(root, RADIAL_MENU_COMPONENT), 'utf8');
  assert.match(radialComponentSource, /t\(item\.labelKey as never\)/, 'ラベルはロケールを経由する');
});

test('盤面上のオブジェクトラベルも日本語（生のcodeを出さない）', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  const label = source.match(/<div className="board-object-label">[\s\S]*?<\/div>/);
  assert.ok(label, 'could not locate board-object-label in board-canvas-panel.tsx');
  assert.doesNotMatch(
    label[0],
    /\{object\.objectTypeCode\}/,
    '盤面上のラベルが生のcode（object.objectTypeCode）をそのまま表示している'
  );
  assert.match(
    label[0],
    /OBJECT_TYPE_LABEL_KEYS\[object\.objectTypeCode\]/,
    '日本語ラベルのマッピングを経由していない'
  );
});

test('上部バーはロール表示・演出強度・参加者アバターを持ち、日本語文言はロケール経由', async () => {
  const source = await readFile(path.join(root, TOP_BAR_COMPONENT), 'utf8');

  assert.match(source, /resolveRoleLabelKey\(roleCode\)/, 'ロール表示はラベルキー変換を経由する');
  assert.match(source, /aria-pressed=\{intensity === code\}/, '演出強度はセグメントボタンで現在値を示す');
  assert.match(source, /resolveAvatarRoster\(participants\)/, '参加者アバターは presence-avatar のピュア関数で整形する');
  assert.match(source, /t\('backToBoardList'\)/, 'ロゴはボード一覧へ戻る導線を兼ねる');
  // 日本語直書き（ハードコード）が無いこと。可視文字列はすべて t() を通す。
  assert.doesNotMatch(source, />[^<>{}]*[぀-ヿ一-鿿][^<>{}]*</, '上部バーに日本語のハードコードがある');
});

test('クエストサイドバーは常設で、操作ヒント凡例とすべてスキップを持つ', async () => {
  const source = await readFile(path.join(root, QUEST_SIDEBAR_COMPONENT), 'utf8');

  assert.match(source, /t\('questEyebrow'\)/);
  assert.match(source, /t\('questSkipAll'\)/);
  assert.match(source, /t\('hintCreate'\)/);
  assert.match(source, /t\('hintRadial'\)/);
  assert.match(source, /t\('hintPan'\)/);
  assert.match(source, /t\('hintZoom'\)/);
  assert.doesNotMatch(source, />[^<>{}]*[぀-ヿ一-鿿][^<>{}]*</, 'サイドバーに日本語のハードコードがある');
});
