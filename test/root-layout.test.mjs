import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule(locale) {
  const source = await readFile(path.join(root, 'src/app/layout.tsx'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => {
    if (specifier === 'next-intl/server') {
      return {getLocale: async () => locale};
    }

    if (specifier === '@/components/client-error-bridge') {
      return {__esModule: true, default: () => null};
    }

    if (specifier === '@/components/query-provider') {
      return {__esModule: true, default: ({children}) => children};
    }

    if (specifier === '@/i18n/routing') {
      return {defaultLocale: 'ja', locales: ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar']};
    }

    if (specifier.endsWith('.css')) {
      return {};
    }

    return require(specifier);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

async function renderLayout(locale) {
  const {default: RootLayout} = await loadModule(locale);
  const React = await import('react');
  const {renderToStaticMarkup} = await import('react-dom/server');
  const markup = await RootLayout({children: React.createElement('main', null, 'content')});

  return renderToStaticMarkup(markup);
}

test('root layout reflects locale and direction', async () => {
  await assert.doesNotReject(async () => {
    const localized = await renderLayout('en');
    assert.match(localized, /<html lang="en" dir="ltr">/);

    const rtl = await renderLayout('ar');
    assert.match(rtl, /<html lang="ar" dir="rtl">/);

    const fallback = await renderLayout('de');
    assert.match(fallback, /<html lang="ja" dir="ltr">/);
  });
});
