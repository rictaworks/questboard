import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {access} from 'node:fs/promises';
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
const START_ATTEMPTS = 3;
const INSTANCE_PROBE_PATH = '/api/health';
const INSTANCE_ENV_KEY = 'QUESTBOARD_INSTANCE_ID';

let port = null;
let baseUrl = null;
let server = null;
let serverOutput = '';
let instanceId = null;

// 設定の読み取りはテストを1つも登録しないうちに済ませる。読み取りが失敗したら
// モジュールの読み込み自体が失敗し、テストが静かに減るのではなくファイルごと
// 失敗として報告される。
const removedLocalePrefixes = readRemovedLocalePrefixes();

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
//
// reserveFreePort() は spawn の前にプローブのソケットを閉じるため、next start の
// 起動が終わるまでのあいだ、別のプロセスが同じ番号を奪う余地が残る。時間で待って
// 生存を確かめる形にすると、負けた next start が猶予より遅く落ちた場合を取り逃がす。
// 代わりに「返ってきた応答が今回起動したプロセスのものか」を毎回確かめる。
// 応答者が別物なら準備完了とは見なさない。
async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    assertServerAlive();

    if (await respondsAsOurInstance()) {
      assertServerAlive();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `next start が ${READY_TIMEOUT_MS}ms 以内にポート ${port} で今回のインスタンス（${instanceId}）として応答しなかった。出力:\n${serverOutput}`
  );
}

// 応答者の同定は、画面の文言ではなく起動ごとのランダムな識別子で行う。
//
// 「日本語の 404 が返ること」で見分けようとすると、同じ成果物を配信する別の
// インスタンス（前回の実行が残したプロセス、別のワークツリーで動いている同版）を
// 今回のビルドだと誤認する。誤認したまま検証を始めると、退行した成果物を
// 一度も見ないままテストが緑になる。
//
// 識別子は spawn 時の環境変数でこのプロセスにだけ渡すため、同じコードから
// 起動された別インスタンスも一致しない。
async function respondsAsOurInstance() {
  let response;
  try {
    response = await fetch(`${baseUrl}${INSTANCE_PROBE_PATH}`, {redirect: 'manual'});
  } catch {
    // 接続拒否は起動途中。次の周回で再試行する。
    return false;
  }

  if (response.status !== 200) {
    return false;
  }

  const body = await response.text();

  // 200 を返したのに JSON でないのは、このエンドポイントを持たない別のサーバーが
  // ポートに居座っている場合。同定できない以上、準備完了とは見なさない。
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  return payload.instance === instanceId;
}

function assertServerAlive() {
  if (server.exitCode === null && server.signalCode === null && !serverOutput.includes('EADDRINUSE')) {
    return;
  }

  throw new Error(
    `next start が起動途中で終了した（exitCode=${server.exitCode} signal=${server.signalCode}）。` +
      `確保したポート ${port} を別のプロセスに奪われた可能性がある。出力:\n${serverOutput}`
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
//
// 同期で読む。ここで await するとモジュール評価がいったん中断し、node:test は
// その時点で登録済みのテストと after フックを走らせてしまう。after は
// next start を停止するため、await より後で登録されるテストは停止済みの
// サーバーに対して実行されることになる。
function readRemovedLocalePrefixes() {
  const source = readFileSync(path.join(root, 'next.config.ts'), 'utf8');
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

// 起動を試みる。ポートを奪われた場合は別のポートで取り直す。
//
// 起動ごとに識別子を作り直す。使い回すと、取り直しの前に起動しかけていた
// プロセスが遅れて応答を返したとき、それを新しい試行のサーバーだと誤認する。
async function startServer() {
  port = await reserveFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverOutput = '';
  instanceId = randomUUID();

  server = spawn(
    process.execPath,
    [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
    {
      cwd: root,
      env: {...process.env, [INSTANCE_ENV_KEY]: instanceId},
      stdio: ['ignore', 'pipe', 'pipe']
    }
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
}

before(async () => {
  await assertBuildExists();

  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt += 1) {
    try {
      await startServer();
      return;
    } catch (cause) {
      await stopServer();

      if (attempt === START_ATTEMPTS) {
        throw cause;
      }
    }
  }
});

// 終了を待ってから抜ける。待たずに抜けると、`next start` が孤児として残り、
// 開発者のマシンでビルド成果物を掴んだままのプロセスが積み上がる。
//
// SIGTERM に応じない場合は SIGKILL まで上げる。待ち続けると node --test 自体が
// 終わらなくなり、CI がジョブのタイムアウトまで戻らない。
async function stopServer() {
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
}

after(stopServer);

// ---------------------------------------------------------------------------
// 応答しているのが今回起動したプロセスであること
// ---------------------------------------------------------------------------

// このファイルの全テストは「waitUntilReady が同定したサーバー」に対して走る。
// 同定が壊れると、以降のテストは別インスタンスを検証したまま緑になり、
// 退行が素通りする。同定の土台そのものをここで検査する。
//
// /api/health が静的化されると、起動時ではなくビルド時の環境変数（通常は未設定）を
// 焼き込んだ応答を返し続けるため、このテストが落ちる。
test('ヘルスチェックが起動時のインスタンス識別子を返す', async () => {
  const {status, body} = await get(INSTANCE_PROBE_PATH);

  assert.equal(status, 200);
  assert.equal(JSON.parse(body).instance, instanceId);
});

// 識別子は起動ごとに変わる。ビルドに焼き込まれた固定値だと、同じ成果物を配信する
// 別インスタンスと区別できず、同定として機能しない。
test('インスタンス識別子が成果物に焼き込まれた固定値でない', async () => {
  const source = readFileSync(path.join(root, 'src/app/api/health/route.ts'), 'utf8');

  assert.match(source, new RegExp(`process\\.env\\.${INSTANCE_ENV_KEY}`));
  assert.match(source, /export const dynamic = ['"]force-dynamic['"]/);
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
//
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

// プロキシやリダイレクト連鎖で error が重複したり、空の値や前後の空白が
// 付いたりしても、キャンセルはキャンセルとして伝える。
for (const query of [
  'error=&error=access_denied',
  'error=invalid_request&error=access_denied',
  'error=%20access_denied'
]) {
  test(`OAuth の ?${query} がキャンセルとして表示される`, async () => {
    const {body} = await get(`/auth/google/callback?${query}`);

    assert.match(mainContent(body), /キャンセルされました/);
    assert.doesNotMatch(mainContent(body), /認可コードが見つかりません/);
  });
}

// error は誰でも与えられる公開 GET のクエリなので、画面には出さない。
// 出すと、攻撃者が書いた文章を製品自身のエラーメッセージとして表示できてしまう。
// 切り分けに要る生の値はバックエンドのログへ送る（reportClientError）。
test('OAuth の error の生の値が画面に出ない', async () => {
  const attackerText = 'sagi-no-annai-desu-0120-000-000';
  const {body} = await get(`/auth/google/callback?error=${attackerText}`);

  assert.match(mainContent(body), /Google 側で認証が中断されました/);
  assert.doesNotMatch(mainContent(body), new RegExp(attackerText));
});

test('OAuth のパラメータ欠落は認可コード欠落として表示される', async () => {
  const {status, body} = await get('/auth/google/callback');

  assert.equal(status, 200);
  assert.match(mainContent(body), /認証を完了できませんでした/);
  assert.match(mainContent(body), /認可コードが見つかりません/);
  assert.doesNotMatch(mainContent(body), /認証に成功しました/);
});
