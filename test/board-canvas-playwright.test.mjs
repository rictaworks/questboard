import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import test, {after, before} from 'node:test';

import {chromium} from 'playwright';

const root = process.cwd();
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? null;
const BOARD_PATH = '/b/test-token';

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
  const deadline = Date.now() + 120_000;

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

  server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      NEXT_PUBLIC_ENV: 'development',
      NEXT_PUBLIC_BACKEND_URL: 'http://127.0.0.1:3001',
      NEXT_PUBLIC_X_CLIENT_ID: 'dummy-client-id',
      NEXT_PUBLIC_X_REDIRECT_URI: 'http://127.0.0.1:3000/auth/x/callback',
      NEXT_PUBLIC_RECAPTCHA_SITE_KEY: 'dummy-recaptcha-key',
      NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE: 'rictaworks',
      NEXT_PUBLIC_SYNC_SERVER_URL: 'ws://127.0.0.1:8080'
    },
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
  browser = await chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
    headless: true
  });
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

test('restore toast actions maintain keyboard focus during toggle', async () => {
  const context = await browser.newContext({locale: 'ja-JP'});
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);

  // ブラウザ側のコンソールログを流す
  page.on('console', (msg) => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });

  try {
    // APIのモック
    await page.route('**/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: { id: 1, displayName: 'Ada Lovelace', planCode: 'member' }
        })
      });
    });

    await page.route('**/boards/test-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          board: { id: 1, title: 'Test Board', shareToken: 'test-token' },
          membership: { userId: 1, role: { id: 1, code: 'owner' } },
          lamportTs: 1,
          objectTypes: [{ id: 1, code: 'sticky' }],
          colorPalettes: [{ id: 1, hex: '#FDE68A' }],
          comments: [],
          objects: [
            {
              id: 9,
              boardId: 1,
              objectTypeCode: 'sticky',
              colorId: 1,
              geometry: { x: 100, y: 100, w: 150, h: 100, rotation: 0 },
              textCrdt: {},
              textCrdtRevision: 0,
              deletedAt: null,
              locked: false,
              lockedByUserId: null,
              commentCount: 0
            }
          ]
        })
      });
    });

    // WebSocketのモック
    await page.routeWebSocket(/ws/, (ws) => {
      ws.onMessage((message) => {
        console.log('[Mock WS] Received message:', message);
        if (message.includes('deletedAt') || message.includes('delete') || message.includes('"id":9')) {
          ws.send(JSON.stringify({
            restoreSuggested: true,
            objectId: '9',
            error: 'オブジェクトは削除されました。復元しますか？'
          }));
        }
      });
    });

    // 画面を開く
    await page.goto(`${resolvedBaseUrl}${BOARD_PATH}`, {waitUntil: 'domcontentloaded'});

    // 参加ボタンまたは成功バナーの表示がある場合は、ダイアログを進める
    // 開発環境では既存メンバー Notice が表示されるため、「閉じる」ボタンを押す必要があるかもしれません
    const dismissButton = page.locator('.board-join-success-dismiss');
    if (await dismissButton.isVisible()) {
      await dismissButton.click();
    }

    await page.locator('.board-canvas-shell').waitFor();
    const userMenu = page.locator('.board-user-menu-trigger');
    await userMenu.waitFor();
    await userMenu.click();
    await page.locator('.board-user-menu-panel').waitFor();
    await page.getByRole('button', {name: 'ログアウト'}).waitFor();

    // オブジェクト（付箋）を選択する
    const sticky = page.locator('.board-object');
    await sticky.waitFor();
    await sticky.click();

    // 削除ボタンをクリックする
    const deleteButton = page.locator('.board-canvas-toolbar button:has-text("削除")');
    await deleteButton.waitFor();
    await deleteButton.click();

    // トーストが出現し、復元ボタンが表示されるのを待つ
    const toast = page.locator('.board-toast');
    await toast.waitFor();
    const restoreButton = toast.locator('button:has-text("復元")');
    await restoreButton.waitFor();

    // 復元ボタンにフォーカスを当てる
    await restoreButton.focus();
    
    // キーボードの Enter を押す
    await page.keyboard.press('Enter');

    // ボタンが「復元を確定」に切り替わる
    const confirmButton = toast.locator('button:has-text("復元を確定")');
    await confirmButton.waitFor();

    // フォーカスが「復元を確定」に維持されているか確認
    const focusedText = await page.evaluate(() => document.activeElement.textContent);
    assert.equal(focusedText.trim(), '復元を確定');

    // キャンセルボタンをクリックして元の状態に戻す
    const cancelButton = toast.locator('button:has-text("キャンセル")');
    await cancelButton.waitFor();
    await cancelButton.click();

    // 再度「復元」ボタンが表示されるのを待つ
    await restoreButton.waitFor();

    // フォーカスが「復元」ボタンに維持されているか確認
    const refocusedText = await page.evaluate(() => document.activeElement.textContent);
    assert.equal(refocusedText.trim(), '復元');

  } catch (error) {
    // 失敗時にHTMLコンテンツを出力してデバッグする
    console.error('Test failed with error:', error);
    const content = await page.content();
    console.log('Page content at failure:', content);
    throw error;
  } finally {
    await context.close();
  }
});
