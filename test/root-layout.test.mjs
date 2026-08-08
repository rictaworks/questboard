import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();
const require = createRequire(import.meta.url);

function transpile(source) {
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  });

  return outputText;
}

async function loadRouting() {
  const source = await readFile(path.join(root, 'src/i18n/routing.ts'), 'utf8');
  const moduleShim = {exports: {}};
  new Function('module', 'exports', transpile(source))(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const realRouting = await loadRouting();

function evaluateModule(outputText, mockRequire) {
  const moduleShim = {exports: {}};
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const React = await import('react');
const {renderToStaticMarkup} = await import('react-dom/server');

// ---------------------------------------------------------------------------
// src/app/layout.tsx — <html lang/dir> を出す唯一のレイアウト
// ---------------------------------------------------------------------------

const rootLayoutOutput = transpile(await readFile(path.join(root, 'src/app/layout.tsx'), 'utf8'));

let rootCssImported = false;

function loadRootLayout(locale) {
  rootCssImported = false;

  const mockRequire = (specifier) => {
    if (specifier === 'next-intl/server') {
      return {
        getLocale: async () => locale,
        getTranslations: async () => (key) => `Metadata.${key}`
      };
    }

    if (specifier === '@/components/client-error-bridge') {
      return {__esModule: true, default: () => null};
    }

    if (specifier === '@/components/query-provider') {
      return {__esModule: true, default: ({children}) => children};
    }

    if (specifier === '@/i18n/routing') {
      return realRouting;
    }

    if (specifier.endsWith('.css')) {
      if (specifier === './globals.css') {
        rootCssImported = true;
      }
      return {};
    }

    return require(specifier);
  };

  return evaluateModule(rootLayoutOutput, mockRequire);
}

async function renderRootLayout(locale) {
  const {default: RootLayout} = loadRootLayout(locale);
  const markup = await RootLayout({children: React.createElement('main', null, 'content')});
  return renderToStaticMarkup(markup);
}

test('root layout reflects ltr direction for en', async () => {
  const html = await renderRootLayout('en');
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.equal(rootCssImported, true, 'globals.css was not imported by the root layout');
});

test('root layout reflects rtl direction for ar', async () => {
  const html = await renderRootLayout('ar');
  assert.match(html, /<html lang="ar" dir="rtl">/);
});

test('root layout renders the app shell inside body', async () => {
  const html = await renderRootLayout('ja');
  assert.match(html, /<body><main>content<\/main>/);
});

test('root layout exposes a default title so tabs never show a raw URL', async () => {
  const {generateMetadata} = loadRootLayout('ja');
  const metadata = await generateMetadata();
  assert.equal(metadata.title, 'Metadata.title');
  assert.equal(metadata.description, 'Metadata.description');
});

// ---------------------------------------------------------------------------
// src/app/[locale]/layout.tsx — <html> を出さず、ロケールの検証だけを担う
// ---------------------------------------------------------------------------

const localeLayoutOutput = transpile(
  await readFile(path.join(root, 'src/app/[locale]/layout.tsx'), 'utf8')
);

function loadLocaleLayout() {
  const mockRequire = (specifier) => {
    if (specifier === 'next-intl/server') {
      return {
        getMessages: async () => ({}),
        getTranslations: async () => (key) => key,
        setRequestLocale: () => {}
      };
    }

    if (specifier === 'next-intl') {
      return {NextIntlClientProvider: ({children}) => children};
    }

    if (specifier === 'next/navigation') {
      return {
        notFound: () => {
          throw new Error('notFound');
        }
      };
    }

    if (specifier === '@/i18n/routing') {
      return realRouting;
    }

    return require(specifier);
  };

  return evaluateModule(localeLayoutOutput, mockRequire);
}

async function renderLocaleLayout(locale) {
  const {default: LocaleLayout} = loadLocaleLayout();
  const markup = await LocaleLayout({
    children: React.createElement('main', null, 'content'),
    params: Promise.resolve({locale})
  });

  return renderToStaticMarkup(markup);
}

test('locale layout does not emit its own html or body element', async () => {
  const html = await renderLocaleLayout('ja');
  assert.doesNotMatch(html, /<html/, 'html は src/app/layout.tsx だけが出力する');
  assert.doesNotMatch(html, /<body/, 'body は src/app/layout.tsx だけが出力する');
  assert.match(html, /<main>content<\/main>/);
});

test('locale layout triggers notFound for invalid locale', async () => {
  await assert.rejects(async () => {
    await renderLocaleLayout('de');
  }, /notFound/);
});

// ---------------------------------------------------------------------------
// src/components/not-found-content.tsx — 404本文の唯一の実装
// ---------------------------------------------------------------------------

const notFoundContentOutput = transpile(
  await readFile(path.join(root, 'src/components/not-found-content.tsx'), 'utf8')
);

async function renderNotFoundContent(locale) {
  const dictionary = {
    title: 'Page non trouvée',
    description: "La page que vous recherchez n'existe pas.",
    homeButton: "Retour à l'accueil"
  };

  const mockRequire = (specifier) => {
    if (specifier === 'next-intl/server') {
      return {
        getLocale: async () => locale,
        getTranslations: async () => (key) => dictionary[key]
      };
    }

    if (specifier === 'next/link') {
      return {
        __esModule: true,
        default: ({href, className, children}) => React.createElement('a', {href, className}, children)
      };
    }

    return require(specifier);
  };

  const {default: NotFoundContent} = evaluateModule(notFoundContentOutput, mockRequire);
  return renderToStaticMarkup(await NotFoundContent());
}

test('not found content renders title, description, and link to current locale', async () => {
  const html = await renderNotFoundContent('fr');

  assert.match(html, /<h1 class="home-title">Page non trouvée<\/h1>/);
  assert.match(
    html,
    /<p class="not-found-description hero-copy">La page que vous recherchez n(&#x27;|')existe pas.<\/p>/
  );
  assert.match(html, /<a href="\/fr" class="button button-primary">Retour à l(&#x27;|')accueil<\/a>/);
});

test('not found pages both delegate to the shared content component', async () => {
  const rootNotFound = await readFile(path.join(root, 'src/app/not-found.tsx'), 'utf8');
  const localeNotFound = await readFile(path.join(root, 'src/app/[locale]/not-found.tsx'), 'utf8');

  for (const [name, source] of [
    ['src/app/not-found.tsx', rootNotFound],
    ['src/app/[locale]/not-found.tsx', localeNotFound]
  ]) {
    assert.match(
      source,
      /from '@\/components\/not-found-content'/,
      `${name} must render the shared NotFoundContent component`
    );
    assert.doesNotMatch(source, /home-shell/, `${name} must not duplicate the 404 markup`);
  }
});
