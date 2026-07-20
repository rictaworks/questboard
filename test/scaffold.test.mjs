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
    assert.ok(json.Home.headline, `${locale} headline missing`);
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
  const files = await walk('src');
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
