import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
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
const READY_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

let port = null;
let baseUrl = null;
let server = null;
let serverOutput = '';

// ポートは固定しない。固定すると、前回の実行が残した `next start`（`after` が
// 走らない Ctrl+C 等で孤児になる）が居座るだけで、以後このファイルの全テストが
// 起動失敗で落ち続け、開発者が自分でプロセスを探して止めるまで復旧しない。
//
// listen(0) でカーネルに空きポートを選ばせ、閉じてからその番号を使う。
// close と next start の間に他プロセスが同じ番号を取る余地は残るが、その場合は
// next start が EADDRINUSE で終了し、waitUntilReady が子プロセスの終了として
// 検出する（別プロセスのサーバーを検証してしまうことはない）。
async function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port: reserved} = probe.address();
      probe.close(() => resolve(reserved));
    });
  });
}

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

// 準備完了は「自分が起動したプロセスが応答すること」で判定する。
//
// Next のログ（"✓ Ready in 351ms"）の文字列一致で判定してはいけない。この文言は
// Next のバージョンや、stdout が TTY でない環境での抑制で変わりうる。変わった瞬間、
// このファイルの全テストがタイムアウトまで待たされたうえで、原因と無関係な
// メッセージで落ちる。
//
// 一方、応答の有無だけで判定するのも危険で、ポートに別のサーバーが居座っていると
// 古いビルドや無関係なサーバーを検証して全件緑になり、
// 「src/app/not-found.tsx を消して組み込みの英語 404 に戻る」退行が通ってしまう。
// そこで毎周回、子プロセスが生きていることを先に確認する。ポート自体も
// reserveFreePort() で空きを確保してから渡しているため、応答者は自分が
// 起動したプロセスに限られる。
async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `next start が起動直後に終了した（exitCode=${server.exitCode} signal=${server.signalCode}）。` +
          `ポート ${port} を確保できなかった可能性がある。出力:\n${serverOutput}`
      );
    }

    try {
      await fetch(`${baseUrl}/`, {redirect: 'manual'});
      return;
    } catch {
      // 接続拒否は起動途中。次の周回で再試行する。
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `next start が ${READY_TIMEOUT_MS}ms 以内にポート ${port} で応答しなかった。出力:\n${serverOutput}`
  );
}

// 画面に出ている文言だけを見る。
//
// このページのクライアントコンポーネントには Auth 名前空間を渡すため、応答本文には
// 未使用のものも含めた Auth のメッセージが RSC ペイロードとして載る。本文全体を
// 検索すると、描画されていない「認証に成功しました」にも一致してしまう。
function mainContent(body) {
  const main = body.match(/<main[\s\S]*?<\/main>/);

  assert.ok(main, '<main> が応答に含まれていない');

  return main[0];
}

// next.config.ts の一覧をテスト側で書き写すと、設定から要素を削ったときに
// テストは緑のまま共有リンクだけが 404 になる。設定ファイルから読み出す。
async function readRemovedLocalePrefixes() {
  const source = await readFile(path.join(root, 'next.config.ts'), 'utf8');
  const declaration = source.match(/const REMOVED_LOCALE_PREFIXES = \[([^\]]*)\]/);

  assert.ok(declaration, 'next.config.ts に REMOVED_LOCALE_PREFIXES の宣言が見つからない');

  return [...declaration[1].matchAll(/'([^']+)'/g)].map(([, locale]) => locale);
}

async function get(pathname, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {headers, redirect: 'manual'});
  const body = await response.text();

  const location = response.headers.get('location');
  const target = location === null ? null : new URL(location, baseUrl);

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

  port = await reserveFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  server = spawn(
    process.execPath,
    [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
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

// 終了を待ってから抜ける。待たずに抜けると、`next start` が孤児として残り、
// 開発者のマシンでビルド成果物を掴んだままのプロセスが積み上がる。
//
// SIGTERM に応じない場合は SIGKILL まで上げる。待ち続けると node --test 自体が
// 終わらなくなり、CI がジョブのタイムアウトまで戻らない。
after(async () => {
  if (server === null || server.exitCode !== null || server.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');

  const killTimer = setTimeout(() => server.kill('SIGKILL'), SHUTDOWN_TIMEOUT_MS);
  try {
    await exited;
  } finally {
    clearTimeout(killTimer);
  }
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
const removedLocalePrefixes = await readRemovedLocalePrefixes();

// 一覧そのものを固定する。「fr や ru は使われていない」と削る整理は自然に見えるが、
// 削った瞬間、その接頭辞つきで配布された共有リンクが 404 になる。多言語をやめる前に
// URL として到達可能だった7つは、リンクが出回っている可能性がある以上すべて残す。
test('救済対象のロケール接頭辞が減らされていない', () => {
  assert.deepEqual(removedLocalePrefixes, ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar']);
});

// 一覧の全要素を検査する。一部だけを書き写すと、書き写していない接頭辞を
// 設定から外してもテストは緑のままになる。
for (const locale of removedLocalePrefixes) {
  test(`/${locale} が / へリダイレクトされる`, async () => {
    const {status, location} = await get(`/${locale}`);

    assert.equal(status, 307, `/${locale} が ${status} を返している`);
    assert.equal(location, '/');
  });

  test(`/${locale}/b/<token> が /b/<token> へリダイレクトされる`, async () => {
    const {status, location} = await get(`/${locale}/b/token123`);

    assert.equal(status, 307, `/${locale}/b/token123 が ${status} を返している`);
    assert.equal(location, '/b/token123');
  });
}

test('旧ロケール接頭辞つきの OAuth コールバック URL もリダイレクトされる', async () => {
  const {status, location} = await get('/ar/auth/google/callback');

  assert.equal(status, 307);
  assert.equal(location, '/auth/google/callback');
});

// 恒久リダイレクト（308）はブラウザがキャッシュし続けるため、将来これらの名前で
// ルートや静的ファイルを配信したくなったときに、設定を直しても既存の利用者は
// 到達できなくなる。旧 URL の救済には 307 で足りる。
test('旧ロケール接頭辞のリダイレクトが恒久（308）にされていない', async () => {
  const {status} = await get('/ja/b/token123');

  assert.notEqual(status, 308);
});

test('旧ロケール接頭辞つき URL のクエリが失われない', async () => {
  const {status, location, search} = await get('/ja/b/token123?invited=1');

  assert.equal(status, 307);
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

// ---------------------------------------------------------------------------
// クライアントへ渡すメッセージが、そのルートで使う名前空間に限られること
// ---------------------------------------------------------------------------

// ルートレイアウトで NextIntlClientProvider を張ると、メッセージを1つも使わない
// 404 にまでカタログ全体が載る。未知の URL を叩くスキャナがアプリシェルごと
// 引くことになるため、404 にボード用の文言が出てこないことを検査する。
test('404 のペイロードにボードキャンバスのメッセージが含まれない', async () => {
  const {body} = await get('/sonzaishinai-na-page');

  assert.doesNotMatch(body, /resetCamera/, 'ja.json 全体が 404 に載っている');
});

// ---------------------------------------------------------------------------
// OAuth コールバックが失敗理由を取り違えないこと
// ---------------------------------------------------------------------------

// Google は同意画面のキャンセルを ?error=access_denied で返す。error を読まないと
// code 欠落と同じ扱いになり、「認証に成功しました」の見出しの下に
// 「認可コードが見つかりません」が並ぶ画面になる。
test('OAuth のキャンセルが成功表示にならず、キャンセルとして表示される', async () => {
  const {status, body} = await get('/auth/google/callback?error=access_denied');

  assert.equal(status, 200);
  assert.match(mainContent(body), /認証を完了できませんでした/);
  assert.match(mainContent(body), /キャンセルされました/);
  assert.doesNotMatch(mainContent(body), /認証に成功しました/);
  assert.doesNotMatch(mainContent(body), /認可コードが見つかりません/);
});

test('OAuth のパラメータ欠落は認可コード欠落として表示される', async () => {
  const {status, body} = await get('/auth/google/callback');

  assert.equal(status, 200);
  assert.match(mainContent(body), /認証を完了できませんでした/);
  assert.match(mainContent(body), /認可コードが見つかりません/);
  assert.doesNotMatch(mainContent(body), /認証に成功しました/);
});
