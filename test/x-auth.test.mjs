import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);

  return moduleShim.exports;
}

const {buildXAuthorizationUrl} = await loadModule('src/lib/x-auth.ts');

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
