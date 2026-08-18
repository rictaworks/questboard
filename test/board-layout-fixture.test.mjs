import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import test, {after, before} from 'node:test';

import {chromium} from 'playwright';

const root = process.cwd();
const FIXTURE_PATH = '/board-layout-fixture';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? null;
const DESKTOP_VIEWPORTS = [
  {width: 1440, height: 900},
  {width: 1366, height: 701},
  {width: 1280, height: 560},
  {width: 1280, height: 360}
];
const NESTED_SCROLL_CHECK_VIEWPORT = {width: 1366, height: 640};
const MOBILE_VIEWPORT = {width: 390, height: 844};

let browser = null;
let server = null;
let resolvedBaseUrl = BASE_URL;

async function reserveFreePort() {
  const {createServer} = await import('node:net');

  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {redirect: 'manual'});
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // 起動途中は接続拒否になる。次の周回で再試行する。
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Playwright 対象サーバーが ${url} で応答しませんでした`);
}

// `next dev` ではなく `next start` を使う。このフィクスチャは右端のコマンドレール
// （issue #183）をクリックしてパネルを開閉する実インタラクションに依存しており、
// `next dev` の HMR 用 WebSocket 接続に失敗する環境（本サンドボックス含む）では
// クライアント側のイベントハンドラが実質的に動かなくなる（クリックしても
// onClick が一切発火しない）。board-canvas-playwright.test.mjs / legal-page.test.mjs
// も同じ理由で `next start` を使っている。
async function startLocalServer() {
  const port = await reserveFreePort();
  resolvedBaseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(root, 'node_modules/next/dist/bin/next');

  server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: root,
    env: {...process.env, NEXT_PUBLIC_ENV: 'development'},
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const output = [];
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => output.push(chunk.toString()));
  }

  await waitForServer(resolvedBaseUrl);

  server.on('exit', (code, signal) => {
    if (code !== 0 && signal == null) {
      process.stderr.write(output.join(''));
    }
  });
}

before(async () => {
  if (!resolvedBaseUrl) {
    await startLocalServer();
  }

  await waitForServer(resolvedBaseUrl);
  browser = await chromium.launch({args: ['--no-sandbox'], headless: true});
});

after(async () => {
  if (browser) {
    await browser.close();
  }

  if (server && server.exitCode == null && server.signalCode == null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
});

async function openFixturePage(viewport) {
  const context = await browser.newContext({viewport, locale: 'ja-JP'});
  const page = await context.newPage();
  await page.goto(`${resolvedBaseUrl}${FIXTURE_PATH}`, {waitUntil: 'domcontentloaded'});
  await page.locator('.board-join-success').waitFor({state: 'attached'});
  await page.locator('.board-canvas-shell').waitFor();
  return {context, page};
}

async function resizeAndMeasure(page, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(100);

  return page.evaluate(() => ({
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight
  }));
}

async function panelMetrics(page, selector) {
  return page.locator(selector).evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
}

test('ボードレイアウトの実測でオーバーレイパネルのスクロール境界が保たれる', async () => {
  const {context, page} = await openFixturePage({width: 1280, height: 560});

  try {
    assert.equal(await page.locator('.board-join-success').isVisible(), true, '参加成功バナーが表示されていません');

    for (const viewport of DESKTOP_VIEWPORTS) {
      const {innerHeight, scrollHeight} = await resizeAndMeasure(page, viewport);
      const shellWidth = await page.locator('main.home-shell').evaluate((element) => element.getBoundingClientRect().width);
      assert.ok(
        scrollHeight <= innerHeight,
        `${viewport.width}×${viewport.height} でページ全体がスクロールしています（scrollHeight=${scrollHeight}, innerHeight=${innerHeight}）`
      );
      assert.ok(
        shellWidth >= viewport.width - 2,
        `${viewport.width}×${viewport.height} で main.home-shell が横幅いっぱいに広がっていません（actual=${shellWidth}）`
      );
    }

    await resizeAndMeasure(page, { width: 1440, height: 900 });

    // クエストサイドバーはモック準拠の常設表示（issue #192）。10件のダミークエストで
    // 使える高さを超えるため、サイドバー自身が内部スクロールする。
    await page.locator('.board-quest-sidebar').waitFor({state: 'visible'});
    await resizeAndMeasure(page, NESTED_SCROLL_CHECK_VIEWPORT);
    const sidebarMetrics = await panelMetrics(page, '.board-quest-sidebar');
    assert.ok(
      sidebarMetrics.scrollHeight > sidebarMetrics.clientHeight,
      `quest sidebar should scroll (${JSON.stringify(sidebarMetrics)})`
    );

    // 詳細パネル（フィクスチャでは静的に開いた状態）は overlay の高さ内で内部スクロールする。
    const detailsMetrics = await panelMetrics(page, '.board-details');
    assert.ok(
      detailsMetrics.scrollHeight > detailsMetrics.clientHeight,
      `details panel should scroll (${JSON.stringify(detailsMetrics)})`
    );

    // ミニマップは右下固定パネル（issue #192）。スクロールせず、盤面は実高さを持つ。
    const minimapMetrics = await panelMetrics(page, '.board-minimap-fixed');
    assert.ok(
      minimapMetrics.scrollHeight <= minimapMetrics.clientHeight,
      `minimap should not scroll (${JSON.stringify(minimapMetrics)})`
    );
    const minimapRect = await page.locator('.board-minimap-fixed').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });
    // 右下に固定されている（ビューポート右下から2段の padding 内に収まる）こと。
    assert.ok(minimapRect.viewportWidth - minimapRect.right < 80, `minimap should hug the right edge (${JSON.stringify(minimapRect)})`);
    assert.ok(minimapRect.viewportHeight - minimapRect.bottom < 80, `minimap should hug the bottom edge (${JSON.stringify(minimapRect)})`);
    const minimapSurfaceRect = await page.locator('.board-minimap-surface').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(minimapSurfaceRect.height > 40, `minimap surface should have a real height (actual: ${minimapSurfaceRect.height}px)`);

    // モバイル幅でもページ自体はスクロールしない（サイドバーは常設のまま、
    // キャンバスが残り幅で縮む。専用のメディアクエリ分岐は持たない）。
    const {innerHeight: mobileInnerHeight, scrollHeight: mobileScrollHeight} = await resizeAndMeasure(page, MOBILE_VIEWPORT);
    assert.ok(
      mobileScrollHeight <= mobileInnerHeight,
      `mobile viewport should not scroll the page (scrollHeight=${mobileScrollHeight}, innerHeight=${mobileInnerHeight})`
    );

    const stageRect = await page.locator('.board-stage').evaluate((element) => element.getBoundingClientRect());
    assert.ok(stageRect.height > MOBILE_VIEWPORT.height * 0.5, `mobile stage should fill most of the viewport height (${stageRect.height})`);
  } finally {
    await context.close();
  }
});
