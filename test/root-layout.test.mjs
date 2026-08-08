import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// レイアウトと 404 の単体テスト。
//
// ここで検証できるのは「与えられたロケールから lang / dir を組み立てられるか」
// までで、「Next が実際にそのシェルで 404 を返すか」は検証できない。
// 実レスポンスの検証は test/not-found-http.test.mjs が担う。
// ---------------------------------------------------------------------------

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

async function loadPureModule(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const moduleShim = {exports: {}};
  const mockRequire = (specifier) => {
    if (specifier === './routing') {
      return realRouting;
    }

    return require(specifier);
  };

  new Function('module', 'exports', 'require', transpile(source))(
    moduleShim,
    moduleShim.exports,
    mockRequire
  );

  return moduleShim.exports;
}

async function loadRouting() {
  const source = await readFile(path.join(root, 'src/i18n/routing.ts'), 'utf8');
  const moduleShim = {exports: {}};
  new Function('module', 'exports', transpile(source))(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const realRouting = await loadRouting();
const realMiddlewareRouting = await loadPureModule('src/i18n/middleware-routing.ts');

function evaluateModule(outputText, mockRequire) {
  const moduleShim = {exports: {}};
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const React = await import('react');
const {renderToStaticMarkup} = await import('react-dom/server');

// ---------------------------------------------------------------------------
// src/app/[locale]/layout.tsx — <html lang/dir> を出すレイアウト
// ---------------------------------------------------------------------------

const localeLayoutOutput = transpile(
  await readFile(path.join(root, 'src/app/[locale]/layout.tsx'), 'utf8')
);

function loadLocaleLayout({requestPathname = null, detectedLocale = 'ja'} = {}) {
  const calls = {redirectedTo: null, cssImported: false, requestLocale: null};

  const mockRequire = (specifier) => {
    if (specifier === 'next-intl/server') {
      return {
        getMessages: async () => ({}),
        getTranslations: async () => (key) => `Metadata.${key}`,
        setRequestLocale: (locale) => {
          calls.requestLocale = locale;
        }
      };
    }

    if (specifier === 'next-intl') {
      return {NextIntlClientProvider: ({children}) => children};
    }

    if (specifier === 'next/headers') {
      return {
        headers: async () => ({get: (name) => (name === realMiddlewareRouting.PATHNAME_HEADER ? requestPathname : null)})
      };
    }

    if (specifier === 'next/navigation') {
      return {
        redirect: (target) => {
          calls.redirectedTo = target;
          throw new Error(`NEXT_REDIRECT:${target}`);
        }
      };
    }

    if (specifier === '@/components/client-error-bridge') {
      return {__esModule: true, default: () => null};
    }

    if (specifier === '@/components/query-provider') {
      return {__esModule: true, default: ({children}) => children};
    }

    if (specifier === '@/i18n/middleware-routing') {
      return realMiddlewareRouting;
    }

    if (specifier === '@/i18n/server-locale') {
      return {resolveRequestLocale: async () => detectedLocale};
    }

    if (specifier === '@/i18n/routing') {
      return realRouting;
    }

    if (specifier.endsWith('.css')) {
      if (specifier === '../globals.css') {
        calls.cssImported = true;
      }
      return {};
    }

    return require(specifier);
  };

  return {module: evaluateModule(localeLayoutOutput, mockRequire), calls};
}

async function renderLocaleLayout(locale, options) {
  const {module, calls} = loadLocaleLayout(options);
  const markup = await module.default({
    children: React.createElement('main', null, 'content'),
    params: Promise.resolve({locale})
  });

  return {html: renderToStaticMarkup(markup), calls};
}

test('locale layout reflects ltr direction for en', async () => {
  const {html, calls} = await renderLocaleLayout('en');

  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.equal(calls.cssImported, true, 'globals.css was not imported by the layout');
});

test('locale layout reflects rtl direction for ar', async () => {
  const {html} = await renderLocaleLayout('ar');

  assert.match(html, /<html lang="ar" dir="rtl">/);
});

test('locale layout renders the app shell inside body', async () => {
  const {html, calls} = await renderLocaleLayout('ja');

  assert.match(html, /<body><main>content<\/main>/);
  assert.equal(calls.requestLocale, 'ja', 'setRequestLocale must receive the URL locale');
});

test('locale layout exposes a default title so tabs never show a raw URL', async () => {
  const {module} = loadLocaleLayout();
  const metadata = await module.generateMetadata({params: Promise.resolve({locale: 'ja'})});

  assert.equal(metadata.title, 'Metadata.title');
  assert.equal(metadata.description, 'Metadata.description');
});

// 不正なロケールで notFound() を投げると、その 404 は lang / dir / globals.css を
// 持たない Next 組み込みのエラーシェルで返る。ロケール付きのパスへ送り直し、
// 「どのルートにも一致しない」経路（global-not-found）に寄せる。
test('locale layout redirects an invalid locale to a locale-prefixed path', async () => {
  const {calls} = loadLocaleLayout({requestPathname: '/robots.txt'});
  const {module} = loadLocaleLayout({requestPathname: '/robots.txt'});

  await assert.rejects(
    async () =>
      module.default({
        children: React.createElement('main', null, 'content'),
        params: Promise.resolve({locale: 'robots.txt'})
      }),
    /NEXT_REDIRECT/
  );

  assert.equal(calls.redirectedTo, null, 'sanity: 別インスタンスの状態が混ざっていない');
});

test('locale layout keeps the original path when redirecting an invalid locale', async () => {
  const loaded = loadLocaleLayout({requestPathname: '/.well-known/acme-challenge/token'});

  await assert.rejects(async () =>
    loaded.module.default({
      children: React.createElement('main', null, 'content'),
      params: Promise.resolve({locale: '.well-known'})
    })
  );

  assert.equal(loaded.calls.redirectedTo, '/ja/.well-known/acme-challenge/token');
});

// リダイレクト先に既定ロケールを固定すると、素通しパスの 404 が全利用者に
// 日本語で返る。ミドルウェアが判定したロケールを使うこと。
test('locale layout redirects an invalid locale to the detected locale, not the default', async () => {
  const loaded = loadLocaleLayout({requestPathname: '/googlehostedservice', detectedLocale: 'ar'});

  await assert.rejects(async () =>
    loaded.module.default({
      children: React.createElement('main', null, 'content'),
      params: Promise.resolve({locale: 'googlehostedservice'})
    })
  );

  assert.equal(loaded.calls.redirectedTo, '/ar/googlehostedservice');
});

// パスのヘッダーが無いのはミドルウェアの不具合。パスを捏造して静かに誤った
// リダイレクトを返すのではなく、原因の分かる例外で落とすこと。
test('locale layout throws instead of inventing a path when the pathname header is missing', async () => {
  const loaded = loadLocaleLayout({requestPathname: null});

  await assert.rejects(
    async () =>
      loaded.module.default({
        children: React.createElement('main', null, 'content'),
        params: Promise.resolve({locale: 'robots.txt'})
      }),
    (error) => {
      assert.doesNotMatch(error.message, /NEXT_REDIRECT/, 'リダイレクトしてはいけない');
      assert.match(error.message, new RegExp(realMiddlewareRouting.PATHNAME_HEADER));
      return true;
    }
  );

  assert.equal(loaded.calls.redirectedTo, null);
});

test('locale layout returns empty metadata for an invalid locale', async () => {
  const {module} = loadLocaleLayout();
  const metadata = await module.generateMetadata({params: Promise.resolve({locale: 'robots.txt'})});

  assert.deepEqual(metadata, {});
});

// ---------------------------------------------------------------------------
// src/app/global-not-found.tsx — [locale] の外側で起きる 404 のシェル
// ---------------------------------------------------------------------------

const globalNotFoundOutput = transpile(
  await readFile(path.join(root, 'src/app/global-not-found.tsx'), 'utf8')
);

function loadGlobalNotFound(locale) {
  let cssImported = false;

  const mockRequire = (specifier) => {
    if (specifier === 'next-intl/server') {
      return {getTranslations: async () => (key) => `Metadata.${key}`};
    }

    if (specifier === '@/components/not-found-content') {
      return {__esModule: true, default: () => React.createElement('main', null, 'not found')};
    }

    if (specifier === '@/i18n/routing') {
      return realRouting;
    }

    if (specifier === '@/i18n/server-locale') {
      return {resolveRequestLocale: async () => locale};
    }

    if (specifier.endsWith('.css')) {
      if (specifier === './globals.css') {
        cssImported = true;
      }
      return {};
    }

    return require(specifier);
  };

  return {module: evaluateModule(globalNotFoundOutput, mockRequire), cssImported: () => cssImported};
}

test('global not found emits its own html shell with lang and dir', async () => {
  const {module, cssImported} = loadGlobalNotFound('ar');
  const html = renderToStaticMarkup(await module.default());

  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /<body><main>not found<\/main><\/body>/);
  assert.equal(cssImported(), true, 'globals.css was not imported by global-not-found');
});

test('global not found exposes a title', async () => {
  const {module} = loadGlobalNotFound('ja');
  const metadata = await module.generateMetadata();

  assert.equal(metadata.title, 'Metadata.title');
});

// ---------------------------------------------------------------------------
// src/i18n/server-locale.ts — ミドルウェアが付けたヘッダーだけを信頼する
// ---------------------------------------------------------------------------

const serverLocaleOutput = transpile(
  await readFile(path.join(root, 'src/i18n/server-locale.ts'), 'utf8')
);

function loadServerLocale(headerValue) {
  const mockRequire = (specifier) => {
    if (specifier === 'next/headers') {
      return {headers: async () => ({get: () => headerValue})};
    }

    if (specifier === './middleware-routing') {
      return realMiddlewareRouting;
    }

    if (specifier === './routing') {
      return realRouting;
    }

    return require(specifier);
  };

  return evaluateModule(serverLocaleOutput, mockRequire);
}

test('server locale accepts a supported locale from the middleware header', async () => {
  const {resolveRequestLocale} = loadServerLocale('ar');

  assert.equal(await resolveRequestLocale(), 'ar');
});

test('server locale falls back to the default locale for unknown values', async () => {
  for (const value of [null, '', 'de', 'ja-JP', '../../etc/passwd']) {
    const {resolveRequestLocale} = loadServerLocale(value);

    assert.equal(await resolveRequestLocale(), realRouting.defaultLocale, `value=${value}`);
  }
});

// ---------------------------------------------------------------------------
// src/components/not-found-content.tsx — 404本文の唯一の実装
// ---------------------------------------------------------------------------

const notFoundContentOutput = transpile(
  await readFile(path.join(root, 'src/components/not-found-content.tsx'), 'utf8')
);

async function renderNotFoundContent(locale) {
  const dictionary = {
    title: 'Page introuvable',
    description: "La page que vous recherchez n'existe pas.",
    homeButton: "Retour à l'accueil"
  };

  const mockRequire = (specifier) => {
    if (specifier === 'next-intl/server') {
      return {getTranslations: async () => (key) => dictionary[key]};
    }

    if (specifier === '@/i18n/server-locale') {
      return {resolveRequestLocale: async () => locale};
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

  assert.match(html, /<h1 class="home-title">Page introuvable<\/h1>/);
  assert.match(
    html,
    /<p class="not-found-description hero-copy">La page que vous recherchez n(&#x27;|')existe pas.<\/p>/
  );
  assert.match(html, /<a href="\/fr" class="button button-primary">Retour à l(&#x27;|')accueil<\/a>/);
});

// `as Route` で型検査を捨てると、ホームへ戻るリンクが壊れてもビルドで気付けない。
test('not found content does not cast away typed routes checking', async () => {
  const source = await readFile(path.join(root, 'src/components/not-found-content.tsx'), 'utf8');

  assert.doesNotMatch(source, /as Route/);
});
