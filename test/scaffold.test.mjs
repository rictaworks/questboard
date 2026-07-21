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

const {defaultLocale, locales} = await loadRouting();
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
    assert.ok(json.Home, `${locale} message namespace missing`);
    assert.ok(json.Auth, `${locale} auth namespace missing`);
    assert.ok(json.Home.headline, `${locale} headline missing`);
    assert.ok(json.Home.authSectionTitle, `${locale} auth section title missing`);
  }

  const ja = JSON.parse(await read('src/messages/ja.json'));
  const en = JSON.parse(await read('src/messages/en.json'));
  assert.doesNotMatch(ja.Home.headline, /^\[TODO]/);
  assert.doesNotMatch(en.Home.headline, /^\[TODO]/);

  for (const locale of pendingLocales) {
    const json = JSON.parse(await read(`src/messages/${locale}.json`));
    assert.match(json.Home.headline, /^\[TODO] translate$/);
  }
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

test('middleware matcher stays in sync with routing locales', async () => {
  const middleware = await read('src/middleware.ts');
  const matcherMatch = middleware.match(/matcher: \['\/', '\/\(([^)]+)\)\/:path\*'\]/);

  assert.ok(matcherMatch, 'middleware matcher pattern not found');
  assert.deepEqual(matcherMatch[1].split('|'), [...locales]);
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
  const backendFiles = (await walk('src/backend')).filter((file) => (
    /\.(rb|yml)$/.test(file)
    && (file.startsWith('src/backend/app/')
      || file.startsWith('src/backend/config/')
      || file.startsWith('src/backend/spec/'))
  ));
  const backendSource = (await Promise.all(backendFiles.map((file) => read(file)))).join('\n');

  assert.match(database, /default:[\s\S]*adapter: sqlite3/);
  assert.match(database, /development:[\s\S]*database: storage\/development\.sqlite3/);
  assert.match(database, /test:[\s\S]*database: storage\/test\.sqlite3/);
  assert.match(database, /production:[\s\S]*url: <%= ENV\.fetch\("DATABASE_URL"\) %>/);
  assert.match(routes, /get "\/healthz", to: "health#show"/);
  assert.match(routes, /namespace :admin do[\s\S]*root to: "dashboard#show"/);

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
  assert.match(main, /server\.New\(cfg\)/);
  assert.match(router, /type Router struct/);
  assert.match(router, /Resolve\(boardID string\)/);
  assert.match(handler, /Query\("boardId"\)/);
  assert.match(handler, /CheckOrigin:/);
  assert.match(server, /GET\("\/healthz"/);
  assert.match(server, /GET\("\/ws"/);
});
