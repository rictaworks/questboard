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
let serverOutput = '';

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

// ポートに fetch が通ることを準備完了の合図にしてはいけない。
//
// ポートが既に埋まっていると、spawn した next start は EADDRINUSE で落ちるが、
// fetch は居座っている別プロセスに対して即座に成功する。しかも fetch の成功は
// 子プロセスが落ちるより先に起きるため、生存フラグを見るだけでは競合に負ける。
// その結果、古いビルドや無関係なサーバーを検証して全件緑になり、
// 「src/app/not-found.tsx を消して組み込みの英語 404 に戻る」退行が通ってしまう。
//
// 自分が起動したプロセスが、意図したポートで Ready と報告するまで待つ。
async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `next start が起動直後に終了した（exitCode=${server.exitCode} signal=${server.signalCode}）。` +
          `ポート ${PORT} が既に使われている可能性がある。出力:\n${serverOutput}`
      );
    }

    // Next は起動時に "- Local: http://localhost:<port>" と "✓ Ready" を出す。
    // 自分が要求したポートで待ち受けていることまで確認する。
    if (serverOutput.includes('Ready') && serverOutput.includes(`:${PORT}`)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `next start が ${READY_TIMEOUT_MS}ms 以内にポート ${PORT} で Ready にならなかった。出力:\n${serverOutput}`
  );
}

async function get(pathname, headers = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {headers, redirect: 'manual'});
  const body = await response.text();

  const location = response.headers.get('location');
  const target = location === null ? null : new URL(location, BASE_URL);

  return {
    status: response.status,
    location: target === null ? null : target.pathname,
    search: target === null ? null : target.search,
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

  // 起動に失敗した理由（EADDRINUSE 等）を握り潰さず、失敗時のメッセージに載せる。
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk) => {
      serverOutput += chunk.toString();
    });
  }

  await waitUntilReady();
});

// 終了を待ってから抜ける。待たずに抜けると、次の実行がまだ生きている
// プロセスのポートに当たり、古いビルドを検証してしまう。
after(async () => {
  if (server === null || server.exitCode !== null || server.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await exited;
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
//
// ここで固定するのは「リダイレクトを挟まないこと」だけにする。ステータスまで
// 404 に固定すると、favicon や robots.txt を後から配置しただけで、ロケール
// ルーティングとは無関係にこのテストが落ち、次の開発者を誤った調査に向かわせる。
for (const pathname of ['/robots.txt', '/wp-login.php', '/favicon.ico', '/sonzaishinai']) {
  test(`${pathname} がロケール付き URL へリダイレクトされない`, async () => {
    const {status, location} = await get(pathname);

    assert.equal(location, null, `${location} へリダイレクトしている`);
    assert.notEqual(status, 307);
    assert.notEqual(status, 308);
  });
}

// 一方、旧ロケール接頭辞つきの URL は 404 にせず、接頭辞を外した先へ送る。
// 多言語をやめる前に配布された共有リンクとブックマークを生かすため。
for (const [legacy, expected] of [
  ['/ja', '/'],
  ['/ja/b/token123', '/b/token123'],
  ['/en/b/token123', '/b/token123'],
  ['/ar/auth/google/callback', '/auth/google/callback']
]) {
  test(`${legacy} が ${expected} へ恒久リダイレクトされる`, async () => {
    const {status, location} = await get(legacy);

    assert.equal(status, 308, `${legacy} が ${status} を返している`);
    assert.equal(location, expected);
  });
}

test('旧ロケール接頭辞つき URL のクエリが失われない', async () => {
  const {status, location, search} = await get('/ja/b/token123?invited=1');

  assert.equal(status, 308);
  assert.equal(location, '/b/token123');
  assert.equal(search, '?invited=1');
});

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
