import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, mkdir, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import test, {after, before} from 'node:test';

// ---------------------------------------------------------------------------
// ビルド済みサーバーに対する実 HTTP テスト。
//
// 単体テスト（test/root-layout.test.mjs）は next-intl をモックしてレイアウトを
// 単体描画するため、「Next が実際にそのレイアウトで 404 を包んでいるか」を
// 検証できない。lang / dir の退行はまさにそこで起きるので、ここだけは
// `next start` を起動して実レスポンスを検証する。
//
// CI は `npm run build && node --test test/*.test.mjs` の順で実行するため、
// このテストの時点で .next は必ず存在する。存在しない場合はフォールバックせず
// 失敗させる（ビルドせずに緑になる方が危険なため）。
// ---------------------------------------------------------------------------

const root = process.cwd();
const PORT = 3987;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 60_000;
const LOCALE_HEADER = 'x-next-intl-locale';

// public/ に置いた実ファイルが配信されることを確認するための一時ファイル。
// next start は起動時に public/ を読むため、サーバー起動前に作る必要がある。
const FIXTURE_MARKER = 'questboard-public-fixture';
const FIXTURE_FILES = [
  {pathname: '/__qb-test-fixture.txt', relativePath: 'public/__qb-test-fixture.txt'},
  // 拡張子を持たないルート直下の実ファイル。ドメイン所有権確認ファイルや CDN の
  // ヘルスチェックパスがこの形なので、拡張子を条件にすると配信されなくなる。
  {pathname: '/__qb-test-fixture', relativePath: 'public/__qb-test-fixture'},
  {
    pathname: '/.well-known/__qb-test-fixture',
    relativePath: 'public/.well-known/__qb-test-fixture'
  }
];

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

async function createFixtures() {
  for (const {relativePath} of FIXTURE_FILES) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), {recursive: true});
    await writeFile(absolutePath, `${FIXTURE_MARKER}\n`, 'utf8');
  }
}

// 後始末はファイルの削除ではなく DELETE/ への移動で行う（CLAUDE.md のゴミ箱運用）。
// 同名があれば上書きされるので、実行を繰り返しても溜まらない。
async function retireFixtures() {
  const trashDir = path.join(root, 'DELETE/test-fixtures');
  await mkdir(trashDir, {recursive: true});

  for (const {relativePath} of FIXTURE_FILES) {
    const absolutePath = path.join(root, relativePath);

    try {
      await access(absolutePath);
    } catch {
      continue;
    }

    await rename(absolutePath, path.join(trashDir, path.basename(relativePath)));
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE_URL}/ja`, {redirect: 'manual'});
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`${BASE_URL} が ${READY_TIMEOUT_MS}ms 以内に応答しなかった`);
}

// 利用者から見た最終的な応答を検証する。途中のリダイレクトは実装の選択なので、
// ここでは追跡して結果だけを見る。
async function getFinal(pathname, headers = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {headers, redirect: 'follow'});
  const body = await response.text();
  const htmlTag = body.match(/<html[^>]*>/)?.[0] ?? '';

  return {status: response.status, htmlTag, body};
}

// リダイレクトを追わず、1 ホップ目の行き先だけを見る。
async function getRedirect(pathname, headers = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {headers, redirect: 'manual'});
  const location = response.headers.get('location');

  return {
    status: response.status,
    location: location === null ? null : new URL(location, BASE_URL).pathname,
    search: location === null ? null : new URL(location, BASE_URL).search
  };
}

before(async () => {
  await assertBuildExists();
  await createFixtures();

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

after(async () => {
  server?.kill('SIGTERM');
  await retireFixtures();
});

// ---------------------------------------------------------------------------
// 1. どの 404 にも lang / dir が付くこと
// ---------------------------------------------------------------------------

// 拡張子付きのパスはミドルウェアのロケール解決を素通しする。実ファイルが無い
// 場合の 404 も、lang / dir / スタイルを持つシェルで返らなければならない。
const ASSET_LIKE_404_PATHS = [
  '/__qb-missing.txt',
  '/__qb-missing.json',
  '/__qb-missing.png',
  '/wp-login.php'
];

for (const pathname of ASSET_LIKE_404_PATHS) {
  test(`${pathname} の 404 が lang/dir を持つドキュメントで返る`, async () => {
    const {status, htmlTag} = await getFinal(pathname);

    assert.equal(status, 404);
    assert.doesNotMatch(
      htmlTag,
      /__next_error__/,
      'lang / dir を持たない Next 組み込みのエラーシェルで返っている'
    );
    assert.equal(htmlTag, '<html lang="ja" dir="ltr">');
  });
}

test('ロケールとして無効な1セグメントのパスがトップページとして 200 で返らない', async () => {
  const {status, body} = await getFinal('/__qb-missing.txt');

  assert.equal(status, 404);
  assert.doesNotMatch(body, /auth-heading/, 'トップページが描画されている');
  assert.doesNotMatch(body, /board-create-heading/, 'トップページが描画されている');
});

// ---------------------------------------------------------------------------
// 2. ロケール接頭辞付きのパスは、拡張子の有無に関わらずそのロケールで返ること
// ---------------------------------------------------------------------------

test('ロケール接頭辞付きの 404 がそのロケールの lang/dir を持つ', async () => {
  const {status, htmlTag} = await getFinal('/ar/unknown');

  assert.equal(status, 404);
  assert.equal(htmlTag, '<html lang="ar" dir="rtl">');
});

test('拡張子付きのロケール接頭辞パスでも lang/dir が既定ロケールに退行しない', async () => {
  const {htmlTag} = await getFinal('/ar/data.json');

  assert.equal(htmlTag, '<html lang="ar" dir="rtl">');
});

test('ロケール接頭辞付きのページが既定ロケールで描画されない', async () => {
  const {htmlTag} = await getFinal('/ar/b/abc.json');

  assert.equal(htmlTag, '<html lang="ar" dir="rtl">');
});

// 404 の見出し・本文・ボタンは全ロケールで翻訳済みであること。ここが未翻訳だと、
// URL を打ち間違えた利用者に見えるのが内部の TODO マーカーだけになる。
test('404 の可視テキストがどのロケールでもプレースホルダにならない', async () => {
  for (const locale of ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar']) {
    const {body} = await getFinal(`/${locale}/unknown`);
    const visibleText = body.match(/<main[\s\S]*<\/main>/)?.[0] ?? '';

    assert.notEqual(visibleText, '', `${locale} の 404 本文が取得できない`);
    assert.doesNotMatch(
      visibleText,
      /\[TODO] translate/,
      `${locale} の 404 本文がプレースホルダのまま`
    );
  }
});

// ---------------------------------------------------------------------------
// 3. 表示言語をクライアントのリクエストヘッダーで操作できないこと
// ---------------------------------------------------------------------------

test('クライアントが送ったロケールヘッダーで URL のロケールを上書きできない', async () => {
  const {htmlTag} = await getFinal('/ja/unknown', {[LOCALE_HEADER]: 'ar'});

  assert.equal(htmlTag, '<html lang="ja" dir="ltr">');
});

test('ロケール解決を素通しするパスでもロケールヘッダーを信頼しない', async () => {
  const {htmlTag} = await getFinal('/__qb-missing.txt', {[LOCALE_HEADER]: 'ar'});

  assert.equal(htmlTag, '<html lang="ja" dir="ltr">');
});

// matcher から `_next` / `_vercel` そのものを除外すると、これらは1セグメントの
// パスなので [locale] に一致し、ミドルウェアを通らないままクライアントの
// ロケールヘッダーがサーバーコンポーネントに届く。
for (const pathname of ['/_next', '/_vercel']) {
  test(`${pathname} でもロケールヘッダーを信頼しない`, async () => {
    const {htmlTag} = await getFinal(pathname, {[LOCALE_HEADER]: 'ar'});

    assert.equal(htmlTag, '<html lang="ja" dir="ltr">');
  });
}

// next-intl のミドルウェアは decodeURI() が失敗するとヘッダーに触れずに素通しする。
// その経路にクライアントのロケールを残してはいけない。
test('不正なパーセントエスケープでロケールヘッダーを持ち込めない', async () => {
  const {body} = await getFinal('/%E0%A4%A', {[LOCALE_HEADER]: 'ar'});

  assert.doesNotMatch(body, /<html lang="ar"/, 'クライアント指定のロケールで描画されている');
});

// ---------------------------------------------------------------------------
// 3-b. 素通しするパスでも、利用者の言語で 404 を返すこと
// ---------------------------------------------------------------------------

// 既定ロケール固定にすると、アラビア語利用者に読めない左横書きの 404 が返り、
// 「ホームに戻る」も日本語サイトへ向かう。
for (const pathname of ['/__qb-missing.txt', '/__qb-missing-without-extension']) {
  test(`${pathname} の 404 が Accept-Language のロケールで返る`, async () => {
    const {status, htmlTag} = await getFinal(pathname, {'accept-language': 'ar'});

    assert.equal(status, 404);
    assert.equal(htmlTag, '<html lang="ar" dir="rtl">');
  });
}

// ---------------------------------------------------------------------------
// 3-c. ロケール接頭辞の無い入口の行き先
// ---------------------------------------------------------------------------

// 共有リンクの受け取り側にはクッキーが無いため、検出は Accept-Language に落ちる。
// 翻訳が未完了のロケールに着地すると、見出しもボタンも "[TODO] translate" になる。
test('ロケール接頭辞の無い共有リンクは既定ロケールへ送られる', async () => {
  const {status, location, search} = await getRedirect('/b/token123?invited=1', {
    'accept-language': 'fr'
  });

  assert.equal(status, 307);
  assert.equal(location, '/ja/b/token123');
  assert.equal(search, '?invited=1', 'クエリを落としてはいけない');
});

// Google に登録する redirect_uri はロケール接頭辞を持てないが、戻ってくる利用者は
// 直前に付いた NEXT_LOCALE クッキーを持つ。既定ロケールに固定するとログインの
// たびに日本語サイトへ飛ばされる。
test('OAuth コールバックはクッキーのロケールを保ち、クエリも落とさない', async () => {
  const {status, location, search} = await getRedirect('/auth/google/callback?code=abc&state=xyz', {
    cookie: 'NEXT_LOCALE=fr'
  });

  assert.equal(status, 307);
  assert.equal(location, '/fr/auth/google/callback');
  assert.equal(search, '?code=abc&state=xyz', '認可コードを落としてはいけない');
});

// ---------------------------------------------------------------------------
// 4. public/ 配下の実ファイルが配信されること
// ---------------------------------------------------------------------------

// 証明書更新（HTTP-01 チャレンジ）・ドメイン所有権確認・universal links は
// いずれもルート直下の実ファイルを取りに来る。ミドルウェアが静的ファイル配信より
// 先に動くため、ここでロケール URL へリダイレクトや rewrite を行うと、
// 検証側はファイルではなく 404 を受け取ることになる。
for (const {pathname} of FIXTURE_FILES) {
  test(`${pathname} が public/ の実ファイルとして配信される`, async () => {
    const response = await fetch(`${BASE_URL}${pathname}`, {redirect: 'manual'});
    const body = await response.text();

    assert.equal(response.status, 200, `${pathname} が ${response.status} で返っている`);
    assert.match(body, new RegExp(FIXTURE_MARKER));
  });
}
