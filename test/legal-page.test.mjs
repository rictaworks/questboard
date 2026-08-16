import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import test, {after, before} from 'node:test';

import {chromium} from 'playwright';

const root = process.cwd();
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? null;
const LEGAL_PATH = '/legal';

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

async function startLocalProdServer() {
  const port = await reserveFreePort();
  resolvedBaseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(root, 'node_modules/next/dist/bin/next');

  // `next dev` ではなく `next start` を使う。node --test はテストファイルを
  // 並行実行するため、board-canvas-playwright.test.mjs も同じ `.next` を
  // 対象に `next start` でサーバーを立てる。`next dev` は起動中も `.next` へ
  // 継続的に書き込むため、並行実行する他方の `next start` が同じ `.next` を
  // 読みに行くタイミングと衝突し、断続的な読み取り失敗を招く。
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
    await startLocalProdServer();
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

test('legal page renders the shared footer and policy links', async () => {
  const context = await browser.newContext({locale: 'ja-JP'});
  const page = await context.newPage();

  try {
    await page.goto(`${resolvedBaseUrl}${LEGAL_PATH}`, {waitUntil: 'domcontentloaded'});
    await page.locator('footer.site-footer').waitFor();
    await page.locator('main.legal-page').waitFor();

    const footer = page.locator('footer.site-footer');
    const panel = footer.locator('.site-footer-panel');

    // 初期状態では折りたたみパネルが非表示であることを検証
    assert.equal(await panel.isVisible(), false, 'フッターパネルは初期状態で非表示であるべきです');

    await footer.locator('summary.site-footer-trigger').click();
    await panel.waitFor({ state: 'visible' });

    // クリック後に折りたたみパネルが表示されることを検証
    assert.equal(await panel.isVisible(), true, 'フッターパネルはクリック後に表示されるべきです');
    await assert.doesNotReject(async () => footer.locator('a[href="/legal#privacy-policy"]').waitFor());
    await assert.doesNotReject(async () => footer.locator('a[href="/legal#terms"]').waitFor());
    await assert.doesNotReject(async () => footer.locator('a[href="/legal#operator"]').waitFor());
    await assert.doesNotReject(async () => footer.locator('a[href="/legal#contact"]').waitFor());

    await assert.doesNotReject(async () => page.locator('#privacy-policy').waitFor());
    await assert.doesNotReject(async () => page.locator('#terms').waitFor());
    await assert.doesNotReject(async () => page.locator('#operator').waitFor());
    await assert.doesNotReject(async () => page.locator('#contact').waitFor());
    await assert.doesNotReject(async () => page.locator('#billing').waitFor());

    await assert.doesNotReject(async () => page.getByText('本ページの正文は日本語です。').waitFor());
    await assert.doesNotReject(async () => page.getByText('現時点で課金機能はありません。').waitFor());
  } finally {
    await context.close();
  }
});
