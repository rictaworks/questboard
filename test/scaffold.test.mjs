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

test('middleware matcher excludes API and static paths', async () => {
  const middlewareModule = await loadMiddleware();
  const matcher = middlewareModule.config?.matcher;

  assert.ok(Array.isArray(matcher), 'middleware matcher must be an array');
  assert.equal(matcher.length, 1, 'middleware matcher should contain exactly 1 entry');

  // パターンはミドルウェア本体から読む。テスト側にコピーを書くと、実装を変えても
  // コピーを貼り直すだけでグリーンに戻せてしまい、挙動を検証しないテストになる。
  const [catchAllPattern] = matcher;
  const matches = (pathname) => new RegExp(`^${catchAllPattern}$`).test(pathname);

  // 1. HTML を返すパスはすべてミドルウェアを通す（ロケールが決まらないと
  //    lang / dir を持たない Next 組み込みの 404 で返ってしまう）
  assert.ok(matches('/'), '/ should match');
  assert.ok(matches('/b/token123'), '/b/token123 should match');
  assert.ok(matches('/auth/google/callback'), '/auth/google/callback should match');
  for (const locale of locales) {
    assert.ok(matches(`/${locale}`), `/${locale} should match`);
    assert.ok(matches(`/${locale}/b/token123`), `/${locale}/b/token123 should match`);
  }

  // 2. 未知のパスも通す。拡張子が静的アセットのものでなければ HTML 扱いにする。
  assert.ok(matches('/apiary'), '/apiary should match');
  assert.ok(matches('/faviconXico'), '/faviconXico should match');
  assert.ok(matches('/wp-login.php'), '/wp-login.php should match (HTML を期待するリクエスト)');
  assert.ok(matches('/index.html'), '/index.html should match');

  // 3. API・Next 内部・Vercel 計測・静的アセットは通さない
  assert.equal(matches('/api'), false, '/api should NOT match');
  assert.equal(matches('/api/hello'), false, '/api/hello should NOT match');
  assert.equal(matches('/_next/static/js/main.js'), false, '/_next/static/js/main.js should NOT match');
  assert.equal(matches('/_vercel/insights/script.js'), false, '/_vercel/insights/script.js should NOT match');
  assert.equal(matches('/favicon.ico'), false, '/favicon.ico should NOT match');
  assert.equal(matches('/sitemap.xml'), false, '/sitemap.xml should NOT match');
  assert.equal(matches('/robots.txt'), false, '/robots.txt should NOT match');
  assert.equal(matches('/logo.png'), false, '/logo.png should NOT match');
  assert.equal(matches('/fonts/inter.woff2'), false, '/fonts/inter.woff2 should NOT match');
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
