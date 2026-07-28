import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule(relativePath, requireImpl) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, requireImpl);
  return moduleShim.exports;
}

test('sanitizeSentryEvent masks share tokens in requests, breadcrumbs, and transactions', async () => {
  const {sanitizeSentryEvent} = await loadModule('src/lib/sentry-sanitizer.ts', () => {
    throw new Error('unexpected require');
  });

  const sanitized = sanitizeSentryEvent({
    request: {url: 'https://app.example.test/ja/boards/share-token-123?auth=true#frag'},
    breadcrumbs: [{data: {url: 'https://app.example.test/b/share-token-456?token=secret'}}],
    transaction: '/ja/b/share-token-789',
  });

  assert.equal(sanitized.request.url, 'https://app.example.test/ja/boards/[redacted]');
  assert.equal(sanitized.breadcrumbs[0].data.url, 'https://app.example.test/b/[redacted]');
  assert.equal(sanitized.transaction, '/ja/b/[redacted]');
});

test('instrumentation-client initializes Sentry immediately with a beforeSend sanitizer', async () => {
  const instrumentationCalls = [];
  const requireImpl = (specifier) => {
    if (specifier === './lib/sentry-client') {
      return {
        initSentryClient: () => {
          instrumentationCalls.push('instrumentation');
          return true;
        }
      };
    }
    throw new Error(`unexpected require: ${specifier}`);
  };

  await loadModule('src/instrumentation-client.ts', requireImpl);

  assert.deepEqual(instrumentationCalls, ['instrumentation']);

  const initCalls = [];
  const {initSentryClient} = await loadModule('src/lib/sentry-client.ts', (specifier) => {
    if (specifier === '@sentry/nextjs') {
      return {init: (options) => initCalls.push(options)};
    }
    if (specifier === '@/lib/sentry-sanitizer') {
      return {sanitizeSentryEvent: (event) => event};
    }
    if (specifier === './sentry-config' || specifier === '@/lib/sentry-config') {
      return {sentryEnabled: () => true};
    }
    throw new Error(`unexpected require: ${specifier}`);
  });

  const enabled = initSentryClient();
  assert.equal(enabled, true);
  assert.equal(initCalls.length, 1);
  assert.equal(typeof initCalls[0].beforeSend, 'function');
  assert.equal(initCalls[0].dsn, process.env.NEXT_PUBLIC_SENTRY_DSN);
});

test('ClientErrorBridge respects sentryEnabled and does not call Sentry.init or overwrite client settings', async () => {
  let reactEffectCalled = false;
  let initCalls = [];

  const requireImpl = (specifier) => {
    if (specifier === 'react') {
      return {
        useEffect: (effect) => {
          reactEffectCalled = true;
          effect();
        }
      };
    }
    if (specifier === '@/lib/sentry-sanitizer') {
      return {
        sanitizeClientErrorUrl: (url) => url
      };
    }
    if (specifier === '@/lib/sentry-config') {
      return {
        sentryEnabled: () => true
      };
    }
    if (specifier === '@sentry/nextjs') {
      return {
        init: (options) => initCalls.push(options)
      };
    }
    throw new Error(`unexpected require: ${specifier}`);
  };

  const {default: ClientErrorBridge} = await loadModule('src/components/client-error-bridge.tsx', requireImpl);

  ClientErrorBridge();
  assert.equal(reactEffectCalled, true);
  assert.equal(initCalls.length, 0);
});

