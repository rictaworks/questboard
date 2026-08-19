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

// issue #209: 使い方ページ。認証不要で表示でき、主要操作のセクションが揃い、
// フッターから /guide へのリンクが存在することを検証する。
test('guide page renders usage sections and is linked from the footer', async () => {
  const context = await browser.newContext({locale: 'ja-JP'});
  const page = await context.newPage();

  try {
    await page.goto(`${resolvedBaseUrl}/guide`, {waitUntil: 'domcontentloaded'});
    await page.locator('main.legal-page').waitFor();

    for (const sectionId of ['board', 'create', 'text', 'handles', 'shape', 'delete', 'camera', 'quests']) {
      await assert.doesNotReject(async () => page.locator(`#${sectionId}`).waitFor(), `#${sectionId} セクションが無い`);
    }
    // exact 指定。将来セクション見出しに「使い方」を含む文言が入っても衝突しないようにする
    await assert.doesNotReject(async () => page.getByRole('heading', {name: '使い方', exact: true}).waitFor());

    const footer = page.locator('footer.site-footer');
    await footer.locator('summary.site-footer-trigger').click();
    await assert.doesNotReject(async () => footer.locator('a[href="/guide"]').waitFor());
    await assert.doesNotReject(async () => footer.locator('a[href="/updates"]').waitFor());
  } finally {
    await context.close();
  }
});

// issue #210: 更新履歴ページ。v1.0.0 の内容が利用者向け表現で掲載され、
// 認証不要で表示できることを検証する。
test('updates page renders release notes newest first', async () => {
  const context = await browser.newContext({locale: 'ja-JP'});
  const page = await context.newPage();

  try {
    await page.goto(`${resolvedBaseUrl}/updates`, {waitUntil: 'domcontentloaded'});
    await page.locator('main.legal-page').waitFor();

    // ページ見出し（h1）は exact 指定にする。バージョン見出し（h2）にも「更新履歴」の
    // 語が入りうるため（例: v1.0.1「更新履歴ページの追加」）、部分一致だと衝突する。
    await assert.doesNotReject(async () => page.getByRole('heading', {name: '更新履歴', exact: true}).waitFor());

    // 初版 v1.0.0 のエントリと、その内容が載っていること
    await assert.doesNotReject(async () => page.locator('#v1-0-0').waitFor());
    await assert.doesNotReject(async () => page.locator('#v1-0-0').getByText('セキュリティ修正').waitFor());

    // 新しい順に並ぶこと。バージョン見出しは追加のたびに増えるため、
    // 個別のバージョン名ではなく「先頭が最新である」構造を検証する。
    const sectionIds = await page.locator('main.legal-page .legal-section').evaluateAll(
      (nodes) => nodes.map((node) => node.id)
    );
    assert.ok(sectionIds.length >= 1, '更新履歴のエントリが1件も無い');
    assert.equal(sectionIds.at(-1), 'v1-0-0', '最も古いエントリは初版 v1.0.0 であるべき');
  } finally {
    await context.close();
  }
});

// issue #209: トップページに未ログインでも読める使い方ページへの導線があることを検証する。
test('home page links to the guide page', async () => {
  const context = await browser.newContext({locale: 'ja-JP'});
  const page = await context.newPage();

  try {
    await page.goto(`${resolvedBaseUrl}/`, {waitUntil: 'domcontentloaded'});
    await assert.doesNotReject(async () => page.locator('.home-guide-link a[href="/guide"]').waitFor());
  } finally {
    await context.close();
  }
});
