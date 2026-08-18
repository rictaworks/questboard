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
  boardShellFallback: '.home-shell:has(.board-canvas-shell) .board-canvas-shell',
  canvasShell: '.board-canvas-shell',
  stage: '.board-stage',
  titleBar: '.board-canvas-title-bar',
  createRail: '.board-canvas-create-rail',
  rail: '.board-canvas-rail',
  railButton: '.board-canvas-rail-button',
  panelOverlay: '.board-canvas-panel-overlay',
  detailsAndQuest: '.board-details, .board-quest-panel',
  minimap: '.board-minimap',
  minimapSurface: '.board-minimap-surface',
  railUserMenuPanel: '.board-canvas-rail .board-user-menu-panel',
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
// レールボタン（2.5rem）の手前で止める、ヘッダー／パネルオーバーレイ共通の右端計算式。
const RAIL_CLEARANCE = "calc(var(--space-4) + 2.5rem + var(--space-3))";

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

test('ボードキャンバスは常設サイドバーを持たず、キャンバスが常に全面を占める', async () => {
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

  // キャンバスは .board-canvas-shell いっぱいに絶対配置で広がる（常設サイドバーが無い）。
  assertDeclaration(rules, SELECTOR.canvasShell, 'position', 'relative');
  assertDeclaration(rules, SELECTOR.canvasShell, 'height', '100%');
  assertDeclaration(rules, SELECTOR.canvasShell, 'overflow', 'hidden');
  assertDeclaration(rules, SELECTOR.stage, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.stage, 'inset', '0');
  // .board-stage 自身に min-height は無い（高さは .board-canvas-shell 側が保証する）。
  assert.equal(
    declarationsOf(rules, SELECTOR.stage).has('min-height'),
    false,
    '.board-stage は絶対配置で親いっぱいに広がるため min-height を持たない'
  );
});

test('タイトルバーは画面上部に隙間なく全幅で固定され、作成レールはそれとは独立してキャンバスの上に浮かぶ', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  // app-ui/ のモック（Questboard Prototype.dc.html）どおり、タイトルバーは画面上部に
  // 隙間なく全幅で固定する。以前はここにオブジェクト作成ボタンまで含めていたため、
  // キャンバス上部の広い帯を丸ごとクリック不可にしていたが、ボタン群は独立した
  // .board-canvas-create-rail に分離したので同じ問題は再発しない
  // （board-canvas-panel.tsx）。
  assertDeclaration(rules, SELECTOR.titleBar, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.titleBar, 'top', '0');
  assertDeclaration(rules, SELECTOR.titleBar, 'left', '0');
  assertDeclaration(rules, SELECTOR.titleBar, 'right', '0');
  assertDeclaration(rules, SELECTOR.titleBar, 'display', 'flex');

  assertDeclaration(rules, SELECTOR.createRail, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.createRail, 'left', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.createRail, 'bottom', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.createRail, 'display', 'flex');
  assertDeclaration(rules, SELECTOR.createRail, 'flex-direction', 'column');

  assertDeclaration(rules, SELECTOR.rail, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.rail, 'top', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.rail, 'right', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.rail, 'bottom', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.rail, 'display', 'flex');
  assertDeclaration(rules, SELECTOR.rail, 'flex-direction', 'column');

  assertDeclaration(rules, SELECTOR.railButton, 'width', '2.5rem');
  assertDeclaration(rules, SELECTOR.railButton, 'height', '2.5rem');
  assertDeclaration(rules, SELECTOR.railButton, 'border-radius', '999px');

  // レール内のユーザーメニューはアイコン専用トリガーの寸法に揃え、
  // ポップオーバーはレールの内側（左）へ開く。
  assertDeclaration(rules, SELECTOR.railUserMenuPanel, 'right', 'calc(100% + var(--space-2))');
  assertDeclaration(rules, SELECTOR.railUserMenuPanel, 'bottom', '0');
});

test('選択中の1枚だけがオーバーレイパネルとしてキャンバスの上に開く', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.panelOverlay, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.panelOverlay, 'top', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.panelOverlay, 'right', RAIL_CLEARANCE);
  assertDeclaration(rules, SELECTOR.panelOverlay, 'bottom', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.panelOverlay, 'width', '22rem');

  // パネル自身は overlay 側が高さを確定させるため min-height を持たず、
  // クエスト／詳細パネルは overflow: auto で内部スクロールする。
  assertDeclaration(rules, SELECTOR.detailsAndQuest, 'overflow', 'auto');
  assert.equal(
    declarationsOf(rules, SELECTOR.detailsAndQuest).has('min-height'),
    false,
    'パネルの高さは .board-canvas-panel-overlay の top/bottom が決めるため min-height は不要'
  );

  // ミニマップだけは俯瞰性を優先してスクロールさせず、盤面は使える高さいっぱいに広がる。
  assertDeclaration(rules, SELECTOR.minimap, 'overflow', 'hidden');
  assert.equal(
    declarationsOf(rules, SELECTOR.minimap).has('min-height'),
    false,
    'ミニマップの高さも overlay 側が決めるため min-height は不要'
  );
  assertDeclaration(rules, SELECTOR.minimapSurface, 'height', '100%');
  assert.equal(
    declarationsOf(rules, SELECTOR.minimapSurface).has('aspect-ratio'),
    false,
    '盤面は常に親グリッド行いっぱいに広がるため aspect-ratio 切り替えは不要'
  );

  assertDeclaration(rules, SELECTOR.userMenu, 'position', 'relative');
  assertDeclaration(rules, SELECTOR.userMenu, 'margin-left', 'auto');
  assertDeclaration(rules, SELECTOR.userMenuTrigger, 'display', 'inline-flex');
  assertDeclaration(rules, SELECTOR.userMenuAvatar, 'width', '2rem');
  assertDeclaration(rules, SELECTOR.userMenuPanel, 'position', 'absolute');
  assertDeclaration(rules, SELECTOR.userMenuPanel, 'top', 'calc(100% + var(--space-2))');
});

test('フッターはボード編集画面ではコマンドレールの列へ視覚的に統合される', async () => {
  const {topLevel} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));
  const rules = indexRules(topLevel);

  assertDeclaration(rules, SELECTOR.footer, 'padding', 'var(--space-3) var(--space-4)');
  assertDeclaration(rules, SELECTOR.boardFooter, 'position', 'fixed');
  assertDeclaration(rules, SELECTOR.boardFooter, 'right', 'calc(var(--space-4) * 2)');
  assertDeclaration(rules, SELECTOR.boardFooter, 'bottom', 'calc(var(--space-4) * 2)');
  assertDeclaration(rules, SELECTOR.footerDisclosure, 'display', 'grid');
  assertDeclaration(rules, SELECTOR.footerTrigger, 'display', 'inline-flex');
  assertDeclaration(rules, SELECTOR.footerPanel, 'display', 'grid');

  // トーストは右下のレール／フッターと重ならないよう左下に置く。
  assertDeclaration(rules, SELECTOR.toasts, 'position', 'fixed');
  assertDeclaration(rules, SELECTOR.toasts, 'left', 'var(--space-4)');
  assertDeclaration(rules, SELECTOR.toasts, 'bottom', 'var(--space-4)');
});

test('ビューポート幅に応じてサイドバーを縦積みへ切り替える分岐はもう存在しない', async () => {
  const {mediaBlocks} = splitTopLevelAndMedia(await readStylesheet(STYLESHEET));

  // キャンバスは常に絶対配置の全面表示、パネルは常にオーバーレイなので、
  // モバイル専用に高さ・レイアウトを作り直す分岐はもう不要（issue #183）。
  const boardCanvasMediaQueries = [...mediaBlocks.entries()].filter(([, block]) => (
    /\.board-canvas-shell|\.board-sidebar|\.board-stage|\.board-canvas-body/.test(block)
  ));
  assert.deepEqual(
    boardCanvasMediaQueries.map(([condition]) => condition),
    [],
    `ボードキャンバス関連のメディアクエリ分岐が残っています: ${boardCanvasMediaQueries.map(([condition]) => condition).join(' / ')}`
  );
});

// スクロール領域をキーボードで到達できるようにするための属性。Chrome は
// スクロールコンテナを自動でフォーカス可能にするが、Firefox / Safari はしない。
const PANEL_CLASSES = ['board-quest-panel', 'board-minimap', 'board-details', 'board-canvas-settings-panel'];

// className は他のクラスと同居する（例: "board-canvas-panel-overlay board-quest-panel"）
// ため、完全一致ではなく空白区切りのトークンとして探す。
function openingTagOf(source, className) {
  const pattern = new RegExp(`<section[^>]*className="[^"]*\\b${className}\\b[^"]*"[^>]*>`);
  const matched = source.match(pattern);
  if (!matched) throw new Error(`className に "${className}" を含む section が見つかりません`);
  return matched[0];
}

test('オーバーレイパネルはキーボードで到達でき、名前を持つ', async () => {
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

test('レールの各トリガーはキャンバス上のパネルを1枚だけ開閉する', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  assert.match(source, /type ActivePanel = 'quests' \| 'minimap' \| 'details' \| 'settings' \| null;/);
  assert.match(source, /function toggleActivePanel\(panel: ActivePanel\)/);
  assert.match(source, /aria-pressed=\{activePanel === 'quests'\}/);
  assert.match(source, /aria-pressed=\{activePanel === 'minimap'\}/);
  assert.match(source, /aria-pressed=\{activePanel === 'details'\}/);
  assert.match(source, /aria-pressed=\{activePanel === 'settings'\}/);
});

// オブジェクトを選択するたびに詳細パネルが割り込む挙動は、選択の主目的（移動・
// 複製等）を毎回邪魔するというフィードバックにより廃止した。詳細パネルは
// 右レールのボタンをユーザーが押したときだけ開く。選択が外れたときに（開いて
// いれば）閉じる後始末だけは残す。
test('オブジェクト選択は詳細パネルを自動で開かない', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  const selectionEffect = source.match(
    /if \(selectedObjectId !== prevSelectedObjectId\) \{[\s\S]*?\n {2}\}/
  );
  assert.ok(selectionEffect, 'could not locate the selection-tracking block in board-canvas-panel.tsx');

  assert.doesNotMatch(
    selectionEffect[0],
    /setActivePanel\('details'\)/,
    '選択のたびに詳細パネルを強制的に開いている（右レールのボタンを押したときだけ開くべき）'
  );
  assert.match(
    selectionEffect[0],
    /selectedObjectId == null[\s\S]*?setActivePanel\(\(current\) => \(current === 'details' \? null : current\)\)/,
    '選択が外れたときに、開いていた詳細パネルを閉じる後始末が無い'
  );
});

// 左レールのオブジェクト作成ボタンはアイコンのみで、以前は aria-label/title に
// バックエンドの生のcode（"sticky"等、英語）をそのまま出していた。オンボーディング
// クエスト（例:「付箋を3枚作る」db/seeds.rb）は日本語のタイトルなので、
// どのアイコンがどのクエストに対応するか分からないというフィードバックにより、
// クエストと同じ日本語ラベルに揃えた。
test('オブジェクト作成ボタンのラベルはクエスト文言と同じ日本語を使う（生のcodeを出さない）', async () => {
  const source = await readFile(path.join(root, CANVAS_COMPONENT), 'utf8');

  assert.match(source, /objectTypeSticky/, '付箋ボタンのラベルキーが無い');
  assert.match(source, /objectTypeShape/);
  assert.match(source, /objectTypeText/);
  assert.match(source, /objectTypeConnector/);
  assert.match(source, /objectTypeImage/);
  assert.match(source, /objectTypeFrame/);

  const railButtons = source.match(
    /boardState\.objectTypes\.map\(\(type\) => \{[\s\S]*?\n {8}\}\)\}/
  );
  assert.ok(railButtons, 'could not locate the object-type rail button mapping');
  assert.doesNotMatch(
    railButtons[0],
    /aria-label=\{type\.code\}|title=\{type\.code\}/,
    'aria-label/title にバックエンドの生のcode（英語）をそのまま出している'
  );
});

// board-object-label（盤面上のオブジェクトそのものに出るラベル）も同じ理由で
// 生のcodeをそのまま表示していた（"STICKY"のように英語のまま見えてしまい、
// クエスト文言「付箋」と結び付かない）。可視テキストも日本語ラベルに揃える。
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
