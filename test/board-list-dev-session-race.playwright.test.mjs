import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import test, {after, before} from 'node:test';

import {chromium} from 'playwright';

const root = process.cwd();
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? null;

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

// board-canvas-playwright.test.mjs / board-layout-fixture.test.mjs と異なり、
// このテストは NEXT_PUBLIC_ENV === 'development' のクライアント分岐（AuthPanel /
// BoardListPanel の isDev 経路）そのものを検証対象にしている。`npm run build` は
// スクリプト内で NEXT_PUBLIC_ENV=production を固定するため、CI が作る共有の
// .next をそのまま使うと production 分岐しか検証できない。development をビルド時
// に焼き込んだ専用サーバーを別途起動する。
async function startLocalDevBakedServer() {
  const port = await reserveFreePort();
  resolvedBaseUrl = `http://127.0.0.1:${port}`;
  const nextBin = path.join(root, 'node_modules/next/dist/bin/next');
  const buildEnv = {
    ...process.env,
    // 通常ビルド（NEXT_PUBLIC_ENV=production）の .next を上書きしない。同一プロセス内で
    // 他のテストファイルが .next を参照する（scaffold.test.mjs の
    // 'production build omits development auth banner' は .next 配下を再帰的に走査する
    // ため、.next のサブディレクトリに退避しても検出されてしまう。.next の外側に
    // 独立したディレクトリを置く（next.config.ts の distDir 設定・.gitignore 参照）。
    NEXT_DIST_DIR: '.next-playwright-dev-session-race',
    // フロント自身と同一オリジンを指す。別オリジンにすると POST /dev/session が
    // CORSプリフライトの対象になり、page.route で素朴にモックしただけでは
    // preflight用のCORSヘッダーが無くブラウザ側でブロックされてしまう
    // （実バックエンドは存在しないため、フロントの/dev/session・/boardsへの
    // リクエストは全て page.route で仮想的に応答する）。
    NEXT_PUBLIC_BACKEND_URL: resolvedBaseUrl,
    NEXT_PUBLIC_ENV: 'development',
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: 'dummy-recaptcha-key',
    NEXT_PUBLIC_SYNC_SERVER_URL: `ws://127.0.0.1:${port}`,
    NEXT_PUBLIC_X_CLIENT_ID: 'dummy-client-id',
    NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE: 'rictaworks',
    NEXT_PUBLIC_X_REDIRECT_URI: `${resolvedBaseUrl}/auth/x/callback`
  };

  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [nextBin, 'build'], {cwd: root, env: buildEnv, stdio: 'pipe'});
    const output = [];
    build.stdout.on('data', (chunk) => output.push(chunk.toString()));
    build.stderr.on('data', (chunk) => output.push(chunk.toString()));
    build.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`development向けビルドが失敗しました:\n${output.join('')}`));
    });
  });

  server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: root,
    env: buildEnv,
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
    await startLocalDevBakedServer();
  }

  await waitForServer(resolvedBaseUrl);
  browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
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

// issue #194 / PR #195 reviewerレビュー対応:
// board-list-panel.tsx はかつて「他のコンポーネント（AuthPanel）が自分より先に
// マウントされ、既に establishDevSession() を呼んでいるはず」という暗黙のマウント順序
// に依存していた（自分では確立を開始しない受動的な awaitDevSession()）。この検証は、
// POST /dev/session をわざと遅延させ、GET /boards がその応答より先に飛ばないこと
// （＝401レースが実際に起きないこと）をブラウザ上で確認する。
test('board list does not race /boards ahead of /dev/session even when the dev session is delayed', async () => {
  const context = await browser.newContext({locale: 'ja-JP'});
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.setDefaultNavigationTimeout(90000);

  const events = [];
  let devSessionRequestCount = 0;

  try {
    // サンドボックス環境では外部フォント取得（Google Fonts）が遅延・失敗しがちで、
    // このテストの本題（/dev/sessionと/boardsの順序）とは無関係にcontext.close()が
    // 長引く原因になるため、遮断してテストを高速・決定的にする。
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

    await page.route(/\/dev\/session$/, async (route) => {
      devSessionRequestCount += 1;
      events.push({type: 'dev-session-request', t: Date.now()});
      // 本番のネットワーク遅延・バックエンドの起動待ちを模して意図的に遅らせる。
      // 遅延がある間に /boards が先に飛んでしまえば401レースが再現する。
      await new Promise((resolve) => setTimeout(resolve, 500));
      events.push({type: 'dev-session-response', t: Date.now()});
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {displayName: 'Dev User', planCode: 'member', xUserId: 'dev-user'}
        })
      });
    });

    // globパターンの '?' はPlaywright上「任意の1文字」を意味し、クエリ文字列区切りの
    // リテラル '?' にマッチしない（glob '**/boards?**' は実際には一致しなかった）。
    // 正規表現で明示的にマッチさせる。
    await page.route(/\/boards\?/, async (route) => {
      events.push({type: 'boards-request', t: Date.now()});
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          boards: [],
          pagination: {
            nextPage: null,
            page: 1,
            perPage: 10,
            previousPage: null,
            totalCount: 0,
            totalPages: 1
          }
        })
      });
    });

    // `.board-list-empty` はSSR時点（sessionState の初期値が既に authenticated:true の
    // ため）で最初のペイントから存在しており、establishDevSession() の完了を待たない。
    // 「読み込みが終わった」ことのDOM上のシグナルとして使えないため、実際のネットワーク
    // レスポンスで /boards が返るのを直接待つ。waitForRequest ではなく waitForResponse を
    // 使うのは、'request' イベントは route ハンドラの実行より先に発火しうり、events への
    // push が完了する前に後続の assert に進んでしまう競合を避けるため
    // （response は route.fulfill 呼び出し後にしか発生しない）。
    const boardsResponsePromise = page.waitForResponse(
      (res) => res.request().method() === 'GET' && res.url().includes('/boards?')
    );

    await page.goto(`${resolvedBaseUrl}/`, {waitUntil: 'domcontentloaded'});

    await boardsResponsePromise;

    const devSessionResponse = events.find((event) => event.type === 'dev-session-response');
    const boardsRequest = events.find((event) => event.type === 'boards-request');

    assert.ok(devSessionResponse, '/dev/session への応答が記録されていない');
    assert.ok(boardsRequest, '/boards への request が記録されていない');

    assert.ok(
      boardsRequest.t >= devSessionResponse.t,
      `/boards が /dev/session の応答完了より先に飛んでいる（401レースが再現した）。` +
        `dev-session応答: ${devSessionResponse.t}, boards request: ${boardsRequest.t}`
    );

    // 複数パネル（AuthPanel・BoardListPanel）が同時に establishDevSession() を
    // 呼んでも、モジュールレベルのキャッシュにより POST は1回しか飛ばない
    // （べき等性の確認）。
    assert.equal(
      devSessionRequestCount,
      1,
      `POST /dev/session が複数回飛んでいる（${devSessionRequestCount}回）。` +
        'establishDevSession のキャッシュが機能していない'
    );
  } finally {
    await context.close();
  }
});
