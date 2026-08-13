import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

const BACKEND_URL = 'https://backend.example.test';

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

const sessionApi = await loadModule('src/lib/session-api.ts', {
  '@/lib/x-auth': {readXAuthSettings: () => ({backendUrl: BACKEND_URL})}
});

// フロントのゲート判定は、サーバーの ApplicationController#require_feature_plan!
// （`code == "member"` 以外を 403）と同じ向きでなければならない。「none だけを塞ぐ」形だと、
// 将来プランが増えたときに UI だけが通してしまい、押した先で 403 が並ぶ。
test('isPlanGated blocks every plan except member', async () => {
  assert.equal(sessionApi.isPlanGated({planCode: 'member'}), false);
  assert.equal(sessionApi.isPlanGated({planCode: 'none'}), true);
  assert.equal(sessionApi.isPlanGated({planCode: 'trial'}), true);
});

// プラン値が取れていない状態を「利用できる」と読むと、判定不能のまま機能を露出させる。
// 判定材料が無いときは塞ぐ側に倒す。
test('isPlanGated blocks when the plan code is unknown', async () => {
  assert.equal(sessionApi.isPlanGated({}), true);
  assert.equal(sessionApi.isPlanGated(null), true);
  assert.equal(sessionApi.isPlanGated(undefined), true);
});

// サーバー（SessionController#recheck）はリクエストボディを一切参照せず、
// SPEC/api/rails-backend.md にもボディ仕様は無い。読まれない値を送ると、
// 「送れば何かが変わる」という誤った仕様が curl 手順や後続の実装に伝播する。
test('requestManualRecheck posts without a body the server does not read', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    calls.push({url, init});
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({authenticated: true, user: {planCode: 'member'}})
    });
  };

  try {
    const session = await sessionApi.requestManualRecheck('fallback');

    assert.equal(session.planCode, 'member');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BACKEND_URL}/session/recheck`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal('body' in calls[0].init, false);
    // RequestOriginGuard#verify_content_type! が POST の media_type を検査するため、
    // ヘッダー自体は残す。
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
