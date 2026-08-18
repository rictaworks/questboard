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
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  const require = createRequire(import.meta.url);
  const mockRequire = (specifier) => (specifier in mocks ? mocks[specifier] : require(specifier));

  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, mockRequire);

  return moduleShim.exports;
}

const {buildXAuthorizationUrl, readFollowTargetHandle, readXAuthSettings} = await loadModule('src/lib/x-auth.ts', {
  '@/lib/backend-url': {
    resolveBackendUrl: (configuredUrl) => configuredUrl
  }
});

test('buildXAuthorizationUrl generates a valid X OAuth2 authorization URL', () => {
  const params = {
    clientId: 'test-client-id',
    codeChallenge: 'test-code-challenge',
    redirectUri: 'https://app.example.com/callback',
    state: 'test-state',
  };

  const urlString = buildXAuthorizationUrl(params);
  const url = new URL(urlString);

  // 1. エンドポイントのホストとパスの検証
  assert.equal(url.origin, 'https://x.com');
  assert.equal(url.pathname, '/i/oauth2/authorize');

  // 2. クエリパラメータの検証
  assert.equal(url.searchParams.get('client_id'), 'test-client-id');
  assert.equal(url.searchParams.get('code_challenge'), 'test-code-challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'test-state');

  // 3. 要求スコープの検証 (tweet.read と users.read の両方が必要)
  const scope = url.searchParams.get('scope');
  assert.ok(scope.includes('tweet.read'), 'should require tweet.read scope');
  assert.ok(scope.includes('users.read'), 'should require users.read scope');
});

test('readFollowTargetHandle trims BOM and surrounding whitespace', () => {
  const original = process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE;
  process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE = '\ufeff @rictaworks \n';

  try {
    assert.equal(readFollowTargetHandle(), 'rictaworks');
  } finally {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE;
    } else {
      process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE = original;
    }
  }
});

test('readFollowTargetHandle rejects values that become empty after normalization', () => {
  const original = process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE;
  process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE = '\ufeff   ';

  try {
    assert.throws(() => readFollowTargetHandle(), /NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE is required/);
  } finally {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE;
    } else {
      process.env.NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE = original;
    }
  }
});

// readXAuthSettings \u306f NEXT_PUBLIC_BACKEND_URL \u3092\u76f4\u63a5\u8aad\u307e\u305a\u3001\u5fc5\u305a resolveBackendUrl \u3092
// \u7d4c\u7531\u3059\u308b\u3053\u3068\uff08Codespaces\u306e\u8ee2\u9001URL\u8d8a\u3057\u306b\u958b\u3044\u305f\u3068\u304d\u306e\u52d5\u7684\u89e3\u6c7a\u304c\u52b9\u304b\u306a\u304f\u306a\u308b\u305f\u3081\uff09\u3002
// \u30c8\u30c3\u30d7\u30ec\u30d9\u30eb\u306e\u6052\u7b49mock\u3060\u3068\u914d\u7dda\u6f0f\u308c\u3092\u898b\u9003\u3059\u306e\u3067\u3001\u5024\u3092\u5909\u63db\u3059\u308bmock\u3067\u5225\u9014\u691c\u8a3c\u3059\u308b\u3002
test('readXAuthSettings routes backendUrl through resolveBackendUrl', async () => {
  const {readXAuthSettings: readXAuthSettingsWithTransform} = await loadModule('src/lib/x-auth.ts', {
    '@/lib/backend-url': {
      resolveBackendUrl: (configuredUrl) => `resolved:${configuredUrl}`
    }
  });

  const originals = {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
    NEXT_PUBLIC_X_CLIENT_ID: process.env.NEXT_PUBLIC_X_CLIENT_ID,
    NEXT_PUBLIC_X_REDIRECT_URI: process.env.NEXT_PUBLIC_X_REDIRECT_URI,
    NEXT_PUBLIC_RECAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  };

  process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:3001';
  process.env.NEXT_PUBLIC_X_CLIENT_ID = 'test-client-id';
  process.env.NEXT_PUBLIC_X_REDIRECT_URI = 'https://app.example.com/callback';
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = 'test-recaptcha-key';

  try {
    assert.equal(readXAuthSettingsWithTransform().backendUrl, 'resolved:http://localhost:3001');
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
