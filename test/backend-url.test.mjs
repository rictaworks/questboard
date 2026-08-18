import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule(relativePath, mocks = {}) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => (specifier in mocks ? mocks[specifier] : require(specifier));

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);
  return moduleShim.exports;
}

const {resolveBackendUrl} = await loadModule('src/lib/backend-url.ts', {
  '@/lib/environment': {
    isDevelopmentEnvironment: () => process.env.NEXT_PUBLIC_ENV === 'development'
  }
});

function setEnv(vars) {
  const originals = {};
  for (const key of Object.keys(vars)) {
    originals[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  return () => {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  };
}

function setWindowLocation(hostname, protocol) {
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: {hostname, protocol}
  };
  return () => {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  };
}

test('resolveBackendUrl returns undefined when configuredUrl is not set', () => {
  const restoreEnv = setEnv({NEXT_PUBLIC_ENV: 'production'});
  try {
    assert.equal(resolveBackendUrl(undefined), undefined);
  } finally {
    restoreEnv();
  }
});

test('resolveBackendUrl in production returns the configured URL unchanged, ignoring the current origin', () => {
  const restoreEnv = setEnv({
    NEXT_PUBLIC_ENV: 'production',
    NEXT_PUBLIC_CODESPACES_FORWARDING_DOMAIN: 'app.github.dev'
  });
  const restoreWindow = setWindowLocation('my-app-3100.app.github.dev', 'https:');

  try {
    assert.equal(
      resolveBackendUrl('https://questboard-backend.up.railway.app'),
      'https://questboard-backend.up.railway.app'
    );
  } finally {
    restoreWindow();
    restoreEnv();
  }
});

test('resolveBackendUrl in development rewrites the Codespaces forwarded frontend origin to the backend port', () => {
  const restoreEnv = setEnv({
    NEXT_PUBLIC_ENV: 'development',
    NEXT_PUBLIC_CODESPACES_FORWARDING_DOMAIN: 'app.github.dev'
  });
  const restoreWindow = setWindowLocation('curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev', 'https:');

  try {
    assert.equal(
      resolveBackendUrl('http://localhost:3001'),
      'https://curly-journey-gxq7gpgxwwj73j6w-3001.app.github.dev'
    );
  } finally {
    restoreWindow();
    restoreEnv();
  }
});

test('resolveBackendUrl in development falls through to the configured URL when the hostname is plain localhost', () => {
  const restoreEnv = setEnv({
    NEXT_PUBLIC_ENV: 'development',
    NEXT_PUBLIC_CODESPACES_FORWARDING_DOMAIN: 'app.github.dev'
  });
  const restoreWindow = setWindowLocation('localhost', 'http:');

  try {
    assert.equal(resolveBackendUrl('http://localhost:3001'), 'http://localhost:3001');
  } finally {
    restoreWindow();
    restoreEnv();
  }
});

test('resolveBackendUrl in development returns the configured URL when the forwarding domain is not configured', () => {
  const restoreEnv = setEnv({
    NEXT_PUBLIC_ENV: 'development',
    NEXT_PUBLIC_CODESPACES_FORWARDING_DOMAIN: undefined
  });
  const restoreWindow = setWindowLocation('curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev', 'https:');

  try {
    assert.equal(resolveBackendUrl('http://localhost:3001'), 'http://localhost:3001');
  } finally {
    restoreWindow();
    restoreEnv();
  }
});

test('resolveBackendUrl in development returns the configured URL when window is unavailable (SSR)', () => {
  const restoreEnv = setEnv({
    NEXT_PUBLIC_ENV: 'development',
    NEXT_PUBLIC_CODESPACES_FORWARDING_DOMAIN: 'app.github.dev'
  });
  const originalWindow = globalThis.window;
  delete globalThis.window;

  try {
    assert.equal(resolveBackendUrl('http://localhost:3001'), 'http://localhost:3001');
  } finally {
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    }
    restoreEnv();
  }
});
