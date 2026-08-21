import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function walk(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await readdir(absoluteDir, {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(relativePath));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function loadSentryConfig() {
  const source = await read('src/lib/sentry-config.ts');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const {sentryEnabled} = await loadSentryConfig();

test('design tokens keep expected values', async () => {
  const colors = await read('src/styles/tokens/colors.css');
  const typography = await read('src/styles/tokens/typography.css');
  const spacing = await read('src/styles/tokens/spacing.css');
  const effects = await read('src/styles/tokens/effects.css');

  assert.match(colors, /--color-purple:\s*#7b2fff;/);
  assert.match(typography, /--font-display:\s*'Cinzel',\s*'Georgia',\s*serif;/);
  assert.match(typography, /--font-body:\s*'Raleway',\s*'Helvetica Neue',\s*sans-serif;/);
  assert.match(spacing, /--space-6:\s*24px;/);
  assert.match(spacing, /--radius-lg:\s*6px;/);
  assert.match(effects, /--shadow-glow-md:\s*0 0 30px var\(--color-glow\), 0 0 60px var\(--color-glow-wide\);/);
});

// 対応言語は日本語のみ。メッセージファイルが1つであること自体を検査する。
// 増やすと URL 接頭辞・ロケール検出・未翻訳の扱いが再び必要になるため、
// 言語追加は方針変更（CLAUDE.md）を伴う判断として扱う。
test('only the japanese message catalog exists', async () => {
  const files = (await walk('src/messages')).sort();

  assert.deepEqual(files, ['src/messages/ja.json']);

  // routing.ts は定数1つのモジュール。値を読むためだけに TypeScript を変換して
  // new Function で評価すると、テストの本題より仕掛けのほうが大きくなる。
  //
  // 引用符・空白・as const の有無には依存させない。書式を揃えただけの変更で
  // 「ロケールが変わった」ように見えるエラーを出すと、次の開発者を無駄に走らせる。
  // ただし行頭の宣言に限る。アンカーを外すとコメントアウトされた旧行にも一致し、
  // 「別の値へ変えた」変更を素通りさせてしまう。
  // 実際に配信される言語は test/not-found-http.test.mjs が <html lang="ja"> で検査する。
  const routing = await read('src/i18n/routing.ts');
  assert.match(routing, /^\s*export\s+const\s+defaultLocale\s*=\s*['"]ja['"]/m);
});

test('the japanese message catalog covers every namespace and has no placeholders', async () => {
  const json = JSON.parse(await read('src/messages/ja.json'));

  assert.ok(json.Metadata, 'metadata namespace missing');
  assert.ok(json.Home, 'home namespace missing');
  assert.ok(json.Footer, 'footer namespace missing');
  assert.ok(json.Auth, 'auth namespace missing');
  assert.ok(json.BoardInvite, 'board invite namespace missing');
  assert.ok(json.Home.title, 'home title missing');
  assert.ok(json.Home.authSectionTitle, 'auth section title missing');
  assert.ok(json.BoardList, 'board list namespace missing');
  assert.ok(json.BoardList.heading, 'board list heading missing');
  assert.ok(json.BoardList.boardTitleHeader, 'board list boardTitleHeader missing');
  assert.ok(json.Auth.unavailableHeading, 'auth unavailableHeading missing');
  assert.ok(json.Auth.unavailableDescription, 'auth unavailableDescription missing');
  assert.ok(json.Auth.unavailableFollowGuide, 'auth unavailableFollowGuide missing');
  assert.ok(json.Auth.manualRecheckButton, 'auth manualRecheckButton missing');
  assert.ok(json.BoardInvite.notFoundHeading, 'board invite notFoundHeading missing');
  assert.ok(json.BoardInvite.notFoundDescription, 'board invite notFoundDescription missing');
  assert.ok(json.BoardCanvas, 'board canvas namespace missing');
  assert.ok(json.BoardCanvas.resetCamera, 'board canvas resetCamera missing');
  assert.ok(json.Legal, 'legal namespace missing');
  assert.ok(json.Legal.title, 'legal title missing');

  // 翻訳待ちのプレースホルダが1つも残っていないこと。多言語をやめた以上、
  // [TODO] translate が画面に出る状態は存在してはならない（Issue #103）。
  assert.doesNotMatch(JSON.stringify(json), /\[TODO]/);
});

// タイトルが空だとブラウザのタブが生の URL 表示になる（Issue #100）。
test('the product name is set for the tab title and the home heading', async () => {
  const json = JSON.parse(await read('src/messages/ja.json'));

  assert.equal(json.Metadata.title, 'Questboard');
  assert.equal(json.Home.title, 'Questboard');
});

// トップページはアプリの入口であって製品紹介の LP ではない。開発用の雛形説明も
// キャッチコピーも置かない（Issue #99）。消したキーが復活していないことを検査する。
test('the home page keeps no scaffold copy and no landing page catchphrase', async () => {
  const removedKeys = [
    'eyebrow',
    'headline',
    'description',
    'primaryAction',
    'secondaryAction',
    'designTokensTitle',
    'designTokensDescription',
    'localesTitle',
    'localesDescription'
  ];

  const json = JSON.parse(await read('src/messages/ja.json'));
  for (const key of removedKeys) {
    assert.equal(key in json.Home, false, `Home.${key} is still defined`);
  }

  const page = await read('src/app/page.tsx');
  assert.equal(page.includes('design-tokens'), false);
  assert.equal(page.includes('#locales'), false);
  assert.match(page, /BoardListPanel/);
});

test('the shared footer is mounted from the root layout', async () => {
  const layout = await read('src/app/layout.tsx');

  assert.match(layout, /import SiteFooter from '@\/components\/site-footer';/);
  assert.match(layout, /<SiteFooter \/>/);
});

// ルートレイアウトの NextIntlClientProvider を外し、ページごとに使う名前空間だけを
// 渡すようにしたため、「どのクライアントコンポーネントからでも全名前空間が引ける」という
// 構造的な保証は無くなった。渡し忘れても use-intl は例外を投げず、既定の
// getMessageFallback がキーパス（例: NotFound.title）をそのまま描画するため、
// 画面に出るまで気づけない。ページの一覧と、実際に呼ばれている名前空間を突き合わせる。
// 起点は page.tsx だけではない。App Router は layout / error / template /
// loading / not-found も描画するため、そこからしか辿れないクライアント
// コンポーネントは、page.tsx 起点の走査では一度も見られない。
//
// たとえば useTranslations('Error') を呼ぶ src/app/error.tsx を足しても、
// どの page.tsx もそれを描画しないので検査から漏れる。use-intl は名前空間が
// 欠けても例外を投げず、既定の getMessageFallback がキーパスを描画するため、
// 日本語のみの製品で利用者が "Error.title" という ASCII 文字列を目にする。
// それでも lint・build・全テストは緑のまま通る。
const ROUTE_ENTRY_BASENAMES = [
  'page.tsx',
  'layout.tsx',
  'error.tsx',
  'global-error.tsx',
  'template.tsx',
  'loading.tsx',
  'not-found.tsx'
];

test('each page passes every namespace its client components use', async () => {
  // 一覧は書き写さない。書き写すと、後から追加されたページが黙って未検査に
  // なる（同じ理由で test/not-found-http.test.mjs もロケール一覧を
  // next.config.ts から読んでいる）。
  const pages = (await walk('src/app'))
    .filter((file) => ROUTE_ENTRY_BASENAMES.includes(path.basename(file)));

  assert.ok(pages.length > 0, 'src/app にルートの入口ファイルが1つも無い');

  for (const page of pages) {
    const used = await collectUseTranslationsNamespaces(page);

    if (used.size === 0) {
      continue;
    }

    const declared = await readClientMessageNamespaces(page);
    const missing = [...used].filter((namespace) => !declared.includes(namespace)).sort();

    assert.deepEqual(
      missing,
      [],
      `${page} の clientMessages([...]) に ${missing.join(', ')} が無い。`
        + 'このページから辿れるクライアントコンポーネントが useTranslations で使っている'
    );
  }
});

// clientMessages([...]) に並ぶ名前空間名を読む。
async function readClientMessageNamespaces(relativePath) {
  const source = await read(relativePath);
  const call = source.match(/clientMessages\(\[([^\]]*)\]\)/);

  assert.ok(call, `${relativePath} に clientMessages([...]) が無い`);

  return [...call[1].matchAll(/['"]([^'"]+)['"]/g)].map(([, namespace]) => namespace);
}

// ページから import を辿り、道中の useTranslations('X') を集める。
// getTranslations（Server Component 側）はプロバイダを必要としないので数えない。
//
// 静的 import だけでなく import('...') 形式も辿る。動的にしただけで検査から
// 外れると、名前空間の渡し忘れを緑のまま通してしまう。
async function collectUseTranslationsNamespaces(entryPath) {
  const namespaces = new Set();
  const visited = new Set();
  const queue = [entryPath];

  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const source = await read(current);

    for (const [, namespace] of source.matchAll(/useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      namespaces.add(namespace);
    }

    const specifiers = [
      ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
      ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)
    ];

    for (const [, specifier] of specifiers) {
      const resolved = await resolveProjectModule(specifier, current);
      if (resolved !== null) {
        queue.push(resolved);
      }
    }
  }

  return namespaces;
}

const MODULE_EXTENSIONS = ['tsx', 'ts', 'mts', 'jsx', 'js', 'mjs'];

// プロジェクト内のモジュールだけを解決する。node_modules への参照は辿らない。
//
// 見つからない（ENOENT）以外の読み取り失敗は握り潰さない。握り潰すと、権限や
// 種別の問題で読めなかったファイルが「プロジェクト外」として素通りし、
// そこにある useTranslations が検査から消える。
async function resolveProjectModule(specifier, fromPath) {
  let base;
  if (specifier.startsWith('@/')) {
    base = path.join('src', specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.join(path.dirname(fromPath), specifier);
  } else {
    return null;
  }

  const candidates = [
    ...MODULE_EXTENSIONS.map((extension) => `${base}.${extension}`),
    ...MODULE_EXTENSIONS.map((extension) => path.join(base, `index.${extension}`))
  ];

  for (const candidate of candidates) {
    try {
      await readFile(path.join(root, candidate), 'utf8');
      return candidate;
    } catch (cause) {
      if (cause.code === 'ENOENT' || cause.code === 'EISDIR') {
        continue;
      }

      throw new Error(`${candidate} を読めなかった（${cause.code}）。import の追跡を続行できない`, {cause});
    }
  }

  return null;
}

test('UI source does not contain hardcoded JSX text', async () => {
  const files = (await walk('src')).filter((file) => file.endsWith('.tsx'));
  const violations = [];

  for (const file of files) {
    const source = await read(file);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const text = node.getText(ast).trim();
        if (text && !/^[\s,./:-]+$/.test(text)) {
          violations.push(`${file}: ${text}`);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(ast);
  }

  assert.deepEqual(violations, []);
});

// ロケールを URL 接頭辞に持たせる構成には戻さない。
//
// [locale] は1セグメントのパスなら何にでも一致するため、/robots.txt や
// /wp-login.php までルートとして受けてしまい、それを打ち消すために
// ミドルウェアでのロケール解決・素通し判定・専用の 404 シェルが必要になる。
// PR #116 ではこの構成で 2 日間に 14 コミット・設計の往復 4 回を要し、
// レビューで確認された不具合 20 件はすべてこの構成に由来していた。
test('locale routing is not reintroduced via a [locale] segment or middleware', async () => {
  const appFiles = await walk('src/app');
  const localeSegments = appFiles.filter((file) => file.includes('[locale]'));

  assert.deepEqual(localeSegments, [], '[locale] セグメントが復活している');

  // Next はミドルウェアを src/ 直下とリポジトリ直下の両方から読み、名前も
  // middleware / proxy（Next 16 の新名称）の2系統、拡張子も ts / js / mjs がある。
  // 一部しか見ないと、見ていないパスに置くだけで検査を素通りできてしまう。
  const middlewareBasenames = ['middleware', 'proxy'];
  const middlewareExtensions = ['ts', 'tsx', 'js', 'mjs'];
  const middlewareDirs = ['src', '.'];

  for (const dir of middlewareDirs) {
    for (const basename of middlewareBasenames) {
      for (const extension of middlewareExtensions) {
        const middlewarePath = path.join(dir, `${basename}.${extension}`);

        await assert.rejects(
          async () => read(middlewarePath),
          /ENOENT/,
          `${middlewarePath} が存在する。ロケール解決のためのミドルウェアは置かない`
        );
      }
    }
  }
});

test('forbidden browser dialogs are not used', async () => {
  const files = (await walk('src')).filter((file) => !file.startsWith('src/backend/vendor/'));
  const contents = await Promise.all(files.map((file) => read(file)));
  const joined = contents.join('\n');

  assert.equal(/\b(alert|confirm|prompt)\s*\(/.test(joined), false);
});

test('production build omits development auth banner', async () => {
  const marker = 'development-auth-bypass';
  let files;
  try {
    files = (await walk('.next')).filter((file) => !file.endsWith('/') && !file.endsWith('.map'));
  } catch {
    assert.fail('.next directory does not exist. Run "npm run build" before running tests.');
  }

  for (const file of files) {
    const fullPath = path.join(root, file);
    let contents;
    try {
      contents = await readFile(fullPath, 'utf8');
    } catch {
      continue;
    }

    if (contents.includes(marker)) {
      assert.fail(`development-only auth banner leaked into the production build artifact: ${file}`);
    }
  }
});

test('backend scaffold uses env vars for config and secrets', async () => {
  const database = await read('src/backend/config/database.yml');
  const routes = await read('src/backend/config/routes.rb');
  const envExample = await read('src/backend/.env.example');
  const sentryInitializer = await read('src/backend/config/initializers/sentry.rb');
  const backendSentryHelper = await read('src/backend/lib/error_tracking.rb');
  const backendFiles = (await walk('src/backend')).filter((file) => (
    /\.(rb|yml)$/.test(file)
    && (file.startsWith('src/backend/app/')
      || file.startsWith('src/backend/config/')
      || file.startsWith('src/backend/spec/'))
  ));
  const backendSource = (await Promise.all(backendFiles.map((file) => read(file)))).join('\n');

  assert.match(database, /default:[\s\S]*adapter: postgresql/);
  assert.match(database, /development:[\s\S]*database: <%= ENV\.fetch\("POSTGRES_DB", "questboard_development"\) %>/);
  assert.match(database, /test:[\s\S]*database: <%= ENV\.fetch\("POSTGRES_TEST_DB", "questboard_test"\) %>/);
  assert.match(database, /production:[\s\S]*url: <%= Rails\.env\.production\? \? ENV\.fetch\("DATABASE_URL"\) : ENV\.fetch\("DATABASE_URL", nil\) %>/);
  assert.match(routes, /get "\/healthz", to: "health#show"/);
  assert.match(routes, /namespace :admin do[\s\S]*root to: "dashboard#show"/);
  assert.match(sentryInitializer, /ENV\.fetch\("SENTRY_DSN"\)/);
  assert.match(sentryInitializer, /config\.environment = Rails\.env\.to_s/);
  assert.match(backendSentryHelper, /def sentry_enabled\?\(env: Rails\.env, dsn: ENV\["SENTRY_DSN"\]\)/);

  for (const variable of [
    'RAILS_MASTER_KEY',
    'DATABASE_URL',
    'CORS_ALLOWED_ORIGINS',
    'ADMIN_BASIC_AUTH_USERNAME',
    'ADMIN_BASIC_AUTH_PASSWORD',
    'SECRET_KEY_BASE',
  ]) {
    assert.match(envExample, new RegExp(`^${variable}=`, 'm'));
  }

  assert.equal(/ADMIN_BASIC_AUTH_(USERNAME|PASSWORD)\s*=\s*["'][^"']+["']/.test(backendSource), false);
  assert.equal(/http_basic_authenticate_with\s+name:\s*["'][^"']+["']/.test(backendSource), false);
});

test('frontend Sentry integration is environment-driven and does not hardcode a DSN', async () => {
  const clientBridge = await read('src/components/client-error-bridge.tsx');
  const sentryConfig = await read('src/lib/sentry-config.ts');

  assert.equal(sentryEnabled('production', 'https://dsn.example/1'), true);
  assert.equal(sentryEnabled('production', '   '), false);
  assert.equal(sentryEnabled('development', 'https://dsn.example/1'), false);
  assert.match(clientBridge, /sentryEnabled\(\)/);
  assert.equal(/Sentry\.init\(/.test(clientBridge), false);
  assert.match(clientBridge, /if \(sentryEnabled\(\)\) {\n\s+return;\n\s+}/);
  assert.match(sentryConfig, /NEXT_PUBLIC_SENTRY_DSN/);
  assert.match(sentryConfig, /env === 'production'/);
  assert.equal(/dsn:\s*['"][^'"]+['"]/.test(clientBridge), false);
  assert.equal(/NEXT_PUBLIC_SENTRY_DSN\s*=\s*['"][^'"]+['"]/.test(clientBridge), false);
});

test('sync server scaffold is workspace-enabled and board-shard aware', async () => {
  const goWork = await read('go.work');
  const goMod = await read('src/sync-server/go.mod');
  const main = await read('src/sync-server/cmd/sync-server/main.go');
  const router = await read('src/sync-server/internal/sharding/router.go');
  const handler = await read('src/sync-server/internal/ws/handler.go');
  const server = await read('src/sync-server/internal/server/server.go');

  assert.match(goWork, /use \([\s\S]*\.\/src\/sync-server[\s\S]*\)/);
  assert.match(goMod, /module github\.com\/rictaworks\/questboard\/src\/sync-server/);
  assert.match(main, /config\.FromEnv\(\)/);
  assert.match(main, /server\.New\(cfg, wsHandler\)/);
  assert.match(router, /type Router struct/);
  assert.match(router, /Resolve\(boardID string\)/);
  assert.match(handler, /Query\("boardId"\)/);
  assert.match(handler, /CheckOrigin:/);
  assert.match(server, /GET\("\/healthz"/);
  assert.match(server, /GET\("\/ws"/);
});

// `.env.example` は設定漏れを防ぐための一覧なので、書き写しで作ると
// 後から追加された変数が黙って抜ける。実際にコードが読んでいる
// NEXT_PUBLIC_* を走査して突き合わせる（NEXT_PUBLIC_ はビルド成果物に
// 埋め込まれる公開値で、値そのものは秘密ではない）。
test('.env.example lists every NEXT_PUBLIC_ variable the frontend reads', async () => {
  const sources = (await walk('src')).filter((file) => /\.(ts|tsx)$/.test(file));
  const referenced = new Set();

  for (const file of sources) {
    for (const [, name] of (await read(file)).matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) {
      referenced.add(name);
    }
  }

  assert.ok(referenced.size > 0, 'src から NEXT_PUBLIC_ の参照が1つも見つからない');

  const example = await read('.env.example');
  const missing = [...referenced].filter((name) => !new RegExp(`^${name}=`, 'm').test(example)).sort();

  assert.deepEqual(missing, [], `.env.example に ${missing.join(', ')} が無い`);
});

// 版数の正はリリースタグ。package.json には version を置かない（issue #244）。
//
// 以前は "1.0.0" のまま残り、タグが v1.0.3 まで進んでも更新されていなかった。
// このリポジトリは private: true でパッケージとして公開しないため version は
// 誰にも読まれず、置いておくと必ずタグとずれる。ずれた値は監査で不適合になる。
//
// 同期する運用に戻すなら、このテストを消してタグ発行手順に同期を組み込むこと。
test('package.json に version を置いていない', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  assert.equal(manifest.private, true, 'private でないなら version が必要になる');
  assert.equal(
    manifest.version,
    undefined,
    'version を置くとリリースタグとずれる。版数の正はタグ側にある'
  );
});
