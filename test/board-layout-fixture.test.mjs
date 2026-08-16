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

async function startLocalDevServer() {
  const port = await reserveFreePort();
  resolvedBaseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(root, 'node_modules/next/dist/bin/next');

  server = spawn(process.execPath, [nextBin, 'dev', '-p', String(port)], {
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
    await startLocalDevServer();
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

test('ボードレイアウトの実測でスクロール境界が保たれる', async () => {
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

    // 通常表示の時（1440x900）に、親パネル .board-minimap が 240px (15rem) 前後の高さを確保し、
    // 盤面がクリップされないようにすることを確認する（ソース順依存による 8rem への意図しない縮小の防止）。
    await resizeAndMeasure(page, { width: 1440, height: 900 });
    const minimapRect = await page.locator('.board-minimap').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert.ok(
      Math.abs(minimapRect.height - 240) < 5,
      `desktop minimap should maintain ~240px (15rem) height (actual height: ${minimapRect.height}px)`
    );

    const questMetrics = await panelMetrics(page, '.board-quest-panel');
    const detailsMetrics = await panelMetrics(page, '.board-details');

    assert.ok(
      questMetrics.scrollHeight > questMetrics.clientHeight,
      `quest panel should scroll (${JSON.stringify(questMetrics)})`
    );
    assert.ok(
      detailsMetrics.scrollHeight > detailsMetrics.clientHeight,
      `details panel should scroll (${JSON.stringify(detailsMetrics)})`
    );
    await resizeAndMeasure(page, NESTED_SCROLL_CHECK_VIEWPORT);
    const minimapMetrics = await panelMetrics(page, '.board-minimap');
    const sidebarMetrics = await panelMetrics(page, '.board-sidebar');
    assert.ok(
      minimapMetrics.scrollHeight <= minimapMetrics.clientHeight,
      `minimap should not scroll (${JSON.stringify(minimapMetrics)})`
    );
    assert.ok(
      sidebarMetrics.scrollHeight <= sidebarMetrics.clientHeight,
      `sidebar should not scroll at ${NESTED_SCROLL_CHECK_VIEWPORT.width}×${NESTED_SCROLL_CHECK_VIEWPORT.height} (${JSON.stringify(sidebarMetrics)})`
    );

    const {innerHeight: mobileInnerHeight, scrollHeight: mobileScrollHeight} = await resizeAndMeasure(page, MOBILE_VIEWPORT);
    assert.ok(
      mobileScrollHeight > mobileInnerHeight,
      `mobile viewport should scroll (${mobileScrollHeight} <= ${mobileInnerHeight})`
    );

    const stageHeight = await page.locator('.board-stage').evaluate((element) => element.getBoundingClientRect().height);
    assert.ok(stageHeight >= 576, `mobile stage should stay at least 36rem (${stageHeight})`);

    const minimapSurfaceRect = await page.locator('.board-minimap-surface').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    const ratio = minimapSurfaceRect.width / minimapSurfaceRect.height;
    assert.ok(
      Math.abs(ratio - 5) < 0.1,
      `mobile minimap surface should maintain 5:1 aspect ratio (actual ratio: ${ratio})`
    );
  } finally {
    await context.close();
  }
});
