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

async function loadRouting() {
  const source = await read('src/i18n/routing.ts');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);
  return moduleShim.exports;
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

async function loadMiddlewareRouting() {
  const source = await read('src/i18n/middleware-routing.ts');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  const require = (specifier) => {
    if (specifier === './routing') {
      return {defaultLocale, locales};
    }
    throw new Error(`Unexpected import in middleware-routing: ${specifier}`);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

async function loadMiddleware() {
  const source = await read('src/middleware.ts');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  const require = (specifier) => {
    if (specifier === 'next-intl/middleware') {
      return {__esModule: true, default: () => null};
    }
    if (specifier === 'next/server') {
      return {NextRequest: class {}, NextResponse: {next: () => null}};
    }
    if (specifier === '@/i18n/middleware-routing') {
      return middlewareRouting;
    }
    if (specifier === '@/i18n/routing') {
      return {defaultLocale, locales};
    }
    throw new Error(`Unexpected import in middleware: ${specifier}`);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, require);
  return moduleShim.exports;
}

const {defaultLocale, locales} = await loadRouting();
const {sentryEnabled} = await loadSentryConfig();
// src/middleware.ts が @/i18n/middleware-routing を読み込むため、
// loadMiddleware() の require シムが返す実体をここで用意しておく。
const middlewareRouting = await loadMiddlewareRouting();
const pendingLocales = locales.filter((locale) => locale !== defaultLocale && locale !== 'en');

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

test('all locale files exist and placeholder locales stay scaffolded', async () => {
  for (const locale of locales) {
    const json = JSON.parse(await read(`src/messages/${locale}.json`));
    assert.ok(json.Metadata, `${locale} metadata namespace missing`);
    assert.ok(json.Home, `${locale} message namespace missing`);
    assert.ok(json.Auth, `${locale} auth namespace missing`);
    assert.ok(json.BoardInvite, `${locale} board invite namespace missing`);
    assert.ok(json.Home.title, `${locale} home title missing`);
    assert.ok(json.Home.authSectionTitle, `${locale} auth section title missing`);
    assert.ok(json.BoardInvite.notFoundHeading, `${locale} board invite notFoundHeading missing`);
    assert.ok(json.BoardInvite.notFoundDescription, `${locale} board invite notFoundDescription missing`);
    assert.ok(json.BoardCanvas, `${locale} board canvas namespace missing`);
    assert.ok(json.BoardCanvas.resetCamera, `${locale} board canvas resetCamera missing`);
    assert.ok(json.NotFound, `${locale} NotFound namespace missing`);
    assert.ok(json.NotFound.title, `${locale} NotFound title missing`);
    assert.ok(json.NotFound.description, `${locale} NotFound description missing`);
    assert.ok(json.NotFound.homeButton, `${locale} NotFound homeButton missing`);
  }

  const ja = JSON.parse(await read('src/messages/ja.json'));
  const en = JSON.parse(await read('src/messages/en.json'));
  assert.doesNotMatch(ja.Metadata.description, /^\[TODO]/);
  assert.doesNotMatch(en.Metadata.description, /^\[TODO]/);
  assert.doesNotMatch(ja.NotFound.description, /^\[TODO]/);
  assert.doesNotMatch(en.NotFound.description, /^\[TODO]/);

  for (const locale of pendingLocales) {
    const json = JSON.parse(await read(`src/messages/${locale}.json`));
    assert.match(json.Home.authSectionTitle, /^\[TODO] translate$/);
  }
});

// 製品名はどのロケールでも同じ表記なので、翻訳待ちのロケールでも
// プレースホルダのままにしない。ブラウザのタブに [TODO] translate と出る（Issue #100）。
test('the product name is not left untranslated in any locale', async () => {
  for (const locale of locales) {
    const json = JSON.parse(await read(`src/messages/${locale}.json`));
    assert.equal(json.Metadata.title, 'Questboard', `${locale} metadata title differs`);
    assert.equal(json.Home.title, 'Questboard', `${locale} home title differs`);
  }
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

  for (const locale of locales) {
    const json = JSON.parse(await read(`src/messages/${locale}.json`));
    for (const key of removedKeys) {
      assert.equal(key in json.Home, false, `${locale} still defines Home.${key}`);
    }
  }

  const page = await read('src/app/[locale]/page.tsx');
  assert.equal(page.includes('design-tokens'), false);
  assert.equal(page.includes('#locales'), false);
});

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

test('middleware matcher only excludes build artifacts', async () => {
  const middlewareModule = await loadMiddleware();
  const matcher = middlewareModule.config?.matcher;

  assert.ok(Array.isArray(matcher), 'middleware matcher must be an array');
  assert.equal(matcher.length, 1, 'middleware matcher should contain exactly 1 entry');

  // パターンはミドルウェア本体から読む。テスト側にコピーを書くと、実装を変えても
  // コピーを貼り直すだけでグリーンに戻せてしまい、挙動を検証しないテストになる。
  const [catchAllPattern] = matcher;
  const matches = (pathname) => new RegExp(`^${catchAllPattern}$`).test(pathname);

  // 1. アプリに届きうるパスはすべてミドルウェアを通す。matcher から外すと
  //    そのパスではクライアントが送ったロケールヘッダーが上書きされず、
  //    表示言語をリクエストヘッダーで操作できてしまう。
  assert.ok(matches('/'), '/ should match');
  assert.ok(matches('/b/token123'), '/b/token123 should match');
  for (const locale of locales) {
    assert.ok(matches(`/${locale}`), `/${locale} should match`);
    assert.ok(matches(`/${locale}/b/token123`), `/${locale}/b/token123 should match`);
  }
  assert.ok(matches('/api/hello'), '/api/hello should match');
  assert.ok(matches('/robots.txt'), '/robots.txt should match');
  assert.ok(matches('/.well-known/acme-challenge/token'), '/.well-known/... should match');
  assert.ok(matches('/wp-login.php'), '/wp-login.php should match');

  // 2. ビルド成果物と計測エンドポイントの「配下」だけを外す
  assert.equal(matches('/_next/static/js/main.js'), false, '/_next/static/js/main.js should NOT match');
  assert.equal(matches('/_vercel/insights/script.js'), false, '/_vercel/insights/script.js should NOT match');

  // 3. `_next` / `_vercel` そのものは対象に含める。1セグメントのパスなので
  //    [locale] に一致してしまい、外すとミドルウェアを通らないまま
  //    クライアントが送ったロケール・パスのヘッダーがサーバーコンポーネントに届く。
  assert.ok(matches('/_next'), '/_next should match');
  assert.ok(matches('/_vercel'), '/_vercel should match');
});

// ロケール解決（リダイレクトとロケールヘッダーの付与）を行うかどうかの判定。
// ここを誤ると、public/ 配下の実ファイル要求がロケール URL へ飛ばされて
// 証明書更新やドメイン所有権確認が壊れる。
test('locale routing is skipped for real file requests but never for locale-prefixed paths', async () => {
  const {shouldSkipLocaleRouting} = middlewareRouting;

  // 1. 実ファイル要求は素通しする。
  //    ルート直下は拡張子の有無で絞らない。絞ると、拡張子を持たない所有権確認
  //    ファイルや CDN のヘルスチェックパスが public/ から配信されなくなる。
  for (const pathname of [
    '/robots.txt',
    '/favicon.ico',
    '/sitemap.xml',
    '/logo.png',
    '/fonts/inter.woff2',
    '/index.html',
    '/googleabc.html',
    '/googlehostedservice',
    '/apple-app-site-association',
    '/_next',
    '/_vercel',
    '/api',
    '/api/hello',
    '/.well-known/acme-challenge/token'
  ]) {
    assert.equal(shouldSkipLocaleRouting(pathname), true, `${pathname} should skip locale routing`);
  }

  // 2. ロケール接頭辞付きのパスは、拡張子があっても必ずロケール解決の対象にする。
  //    外すと /ar/data.json のようなパスで lang / dir が既定ロケールへ退行する。
  for (const locale of locales) {
    assert.equal(shouldSkipLocaleRouting(`/${locale}`), false, `/${locale} should be routed`);
    assert.equal(
      shouldSkipLocaleRouting(`/${locale}/data.json`),
      false,
      `/${locale}/data.json should be routed`
    );
    assert.equal(
      shouldSkipLocaleRouting(`/${locale}/b/token123`),
      false,
      `/${locale}/b/token123 should be routed`
    );
  }

  // 3. ルート自身と多階層の通常パスはロケール解決の対象。
  //    /b/token123 は過去に配布された（ロケール接頭辞の無い）共有リンクなので、
  //    ここを素通しにすると既存のリンクがロケール解決されず 404 に落ちる。
  for (const pathname of ['/', '/b/token123', '/auth/google/callback']) {
    assert.equal(shouldSkipLocaleRouting(pathname), false, `${pathname} should be routed`);
  }
});

// ロケール接頭辞の無い共有リンクは、受け取り側の Accept-Language で解決させない。
// 翻訳が未完了のロケールに着地すると "[TODO] translate" だけが見える。
test('locale-less share links go to the default locale, not the detected one', async () => {
  const {requiresDefaultLocale} = middlewareRouting;

  assert.equal(requiresDefaultLocale('/b/token123'), true, '/b/token123 must use the default locale');

  // ロケール接頭辞が付いていればそのロケールを尊重する
  for (const locale of locales) {
    assert.equal(
      requiresDefaultLocale(`/${locale}/b/token123`),
      false,
      `/${locale}/b/token123 must keep its locale`
    );
  }

  // OAuth のコールバックは本人のクッキー由来の検出結果に任せる
  assert.equal(requiresDefaultLocale('/auth/google/callback'), false);
  // 前方一致で誤って拾わないこと
  assert.equal(requiresDefaultLocale('/board'), false);
  assert.equal(requiresDefaultLocale('/b'), false);
});

// 壊れたパスを next-intl に渡すと、リクエストヘッダーに触れないまま素通しされ、
// クライアントが送ったロケールがサーバーコンポーネントに届く。
test('malformed pathnames are classified as undecodable so next-intl never sees them', async () => {
  const {isDecodablePathname} = middlewareRouting;

  assert.equal(isDecodablePathname('/ja/%E7%B4%84'), true, 'valid escapes should decode');
  assert.equal(isDecodablePathname('/ja/plain'), true, 'plain paths should decode');
  assert.equal(isDecodablePathname('/%E0%A4%A'), false, 'truncated escape should not decode');
  assert.equal(isDecodablePathname('/%ZZ'), false, 'invalid escape should not decode');
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
