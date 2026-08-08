import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import test, {after, before} from 'node:test';

// ---------------------------------------------------------------------------
// ビルド済みサーバーに対する実 HTTP テスト。
//
// 「src/app/not-found.tsx が存在すること」をソース検査で確かめても、Next が実際に
// そのファイルで 404 を描画しているかは分からない。組み込みの英語 404 が返って
// いても、その種のテストは緑になる。ここだけは `next start` を起動して
// 実レスポンスを検証する。
//
// CI は `npm run build && node --test test/*.test.mjs` の順で実行するため、
// この時点で .next は必ず存在する。無い場合はフォールバックせず失敗させる。
// ---------------------------------------------------------------------------

const root = process.cwd();
const PORT = 3987;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

let server = null;

async function assertBuildExists() {
  const buildDir = path.join(root, '.next');

  try {
    await access(buildDir);
  } catch (cause) {
    throw new Error(
      `${buildDir} が存在しない。このテストはビルド済みの成果物に対して実行する。先に \`npm run build\` を実行すること。`,
      {cause}
    );
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await fetch(BASE_URL, {redirect: 'manual'});
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`${BASE_URL} が ${READY_TIMEOUT_MS}ms 以内に応答しなかった`);
}

async function get(pathname, headers = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {headers, redirect: 'manual'});
  const body = await response.text();

  return {
    status: response.status,
    location: response.headers.get('location'),
    htmlTag: body.match(/<html[^>]*>/)?.[0] ?? '',
    body
  };
}

before(async () => {
  await assertBuildExists();

  server = spawn(
    process.execPath,
    [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(PORT)],
    {cwd: root, stdio: ['ignore', 'pipe', 'pipe']}
  );

  server.on('error', (error) => {
    throw error;
  });

  await waitUntilReady();
});

after(() => {
  server?.kill('SIGTERM');
});

// ---------------------------------------------------------------------------
// 404 が日本語で、サイトのシェルの中に描画されること
// ---------------------------------------------------------------------------

test('404 が日本語の本文で返り、Next 組み込みの英語シェルにならない', async () => {
  const {status, body, htmlTag} = await get('/sonzaishinai-na-page');

  assert.equal(status, 404);
  assert.equal(htmlTag, '<html lang="ja">');
  assert.doesNotMatch(
    body,
    /This page could not be found/,
    'Next 組み込みの英語 404 が返っている（src/app/not-found.tsx が効いていない）'
  );
  assert.match(body, /ページが見つかりません/);
  assert.match(body, /ホームに戻る/);
});

// ---------------------------------------------------------------------------
// ロケール接頭辞ルーティングが復活していないこと
// ---------------------------------------------------------------------------

// [locale] 構成に戻ると、これらは 404 の前にロケール付き URL へリダイレクトされ、
// 監視チェックやクローラが 404 を期待する場面でリダイレクトを見ることになる。
for (const pathname of ['/robots.txt', '/wp-login.php', '/favicon.ico', '/sonzaishinai']) {
  test(`${pathname} がリダイレクトを挟まず 404 を返す`, async () => {
    const {status, location} = await get(pathname);

    assert.equal(status, 404);
    assert.equal(location, null, `${location} へリダイレクトしている`);
  });
}

// 表示言語はリクエストヘッダーの影響を受けない。日本語のみの製品なので、
// Accept-Language や next-intl の内部ヘッダーで切り替わってはいけない。
test('リクエストヘッダーで表示言語を切り替えられない', async () => {
  const {htmlTag, body} = await get('/sonzaishinai', {
    'accept-language': 'ar',
    'x-next-intl-locale': 'ar'
  });

  assert.equal(htmlTag, '<html lang="ja">');
  assert.match(body, /ページが見つかりません/);
});

// トップページはロケール接頭辞へリダイレクトせず、そのまま表示される。
test('トップページがリダイレクトせず 200 で返る', async () => {
  const {status, htmlTag} = await get('/');

  assert.equal(status, 200);
  assert.equal(htmlTag, '<html lang="ja">');
});
