import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadRouting() {
  const source = await readFile(path.join(root, 'src/i18n/routing.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const realRouting = await loadRouting();

let cssImported = false;

async function loadModule(locale) {
  const source = await readFile(path.join(root, 'src/app/[locale]/layout.tsx'), 'utf8');
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
      return {
        getMessages: async () => ({}),
        getTranslations: async () => (key) => key,
        setRequestLocale: () => {}
      };
    }

    if (specifier === 'next-intl') {
      return {
        NextIntlClientProvider: ({children}) => children
      };
    }

    if (specifier === 'next/navigation') {
      return {
        notFound: () => {
          throw new Error('notFound');
        }
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
      if (specifier === '../globals.css') {
        cssImported = true;
      }
      return {};
    }

    return require(specifier);
  };

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

async function renderLayout(locale) {
  cssImported = false;
  const {default: LocaleLayout} = await loadModule(locale);
  const React = await import('react');
  const {renderToStaticMarkup} = await import('react-dom/server');
  const params = Promise.resolve({locale});
  const markup = await LocaleLayout({children: React.createElement('main', null, 'content'), params});

  return renderToStaticMarkup(markup);
}

test('root layout reflects ltr direction for en', async () => {
  const localized = await renderLayout('en');
  assert.match(localized, /<html lang="en" dir="ltr">/);
  assert.equal(cssImported, true, 'globals.css was not imported');
});

test('root layout reflects rtl direction for ar', async () => {
  const rtl = await renderLayout('ar');
  assert.match(rtl, /<html lang="ar" dir="rtl">/);
});

test('root layout triggers notFound for invalid locale', async () => {
  await assert.rejects(async () => {
    await renderLayout('de');
  }, /notFound/);
});
