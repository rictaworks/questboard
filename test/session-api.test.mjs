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

// フォロー対象ハンドルの解決に失敗しても、それはセッションの失敗ではない。
// 解決をセッション読み込みから切り分けないと、環境変数の設定漏れが
// 「未ログイン」として扱われ、認証済みの利用者に「ログインし直し」を促してしまう。
test('resolveFollowTargetHandle reports its own failure without discarding the session', async () => {
  const resolution = sessionApi.resolveFollowTargetHandle(
    {planCode: 'none'},
    () => {
      throw new Error('NEXT_PUBLIC_X_FOLLOW_TARGET_HANDLE is required');
    },
    'fallback'
  );

  assert.equal(resolution.followTargetHandle, null);
  assert.equal(resolution.errorMessage, 'fallback');
});

// 案内はゲートに掛かった利用者にしか出さない。利用できる利用者まで読みに行くと、
// この環境変数の設定漏れが member の利用者まで巻き込む。
test('resolveFollowTargetHandle only reads the environment for gated sessions', async () => {
  let reads = 0;
  const readHandle = () => {
    reads += 1;
    return 'rictaworks';
  };

  assert.deepEqual(
    sessionApi.resolveFollowTargetHandle({planCode: 'member'}, readHandle, 'fallback'),
    {followTargetHandle: null, errorMessage: null}
  );
  assert.equal(reads, 0);

  assert.deepEqual(
    sessionApi.resolveFollowTargetHandle({planCode: 'none'}, readHandle, 'fallback'),
    {followTargetHandle: 'rictaworks', errorMessage: null}
  );
  assert.equal(reads, 1);
});

// Error 以外が投げられても、利用者に何も出ないまま利用不可画面だけが残る状態にしない。
test('resolveFollowTargetHandle falls back to the caller message for non-Error throws', async () => {
  const resolution = sessionApi.resolveFollowTargetHandle(
    {planCode: 'none'},
    () => {
      throw 'boom';
    },
    'fallback'
  );

  assert.equal(resolution.followTargetHandle, null);
  assert.equal(resolution.errorMessage, 'fallback');
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

// フロントの開発認証バイパス（auth-panel.tsx の isDev 分岐）は、見た目だけ認証済みに
// 見せかけて実際のセッションCookieを張らないと、ボード作成のような書き込み系が
// 常に401になる。ここでバックエンドの開発専用エンドポイント（POST /dev/session）を
// 実際に叩き、本物のセッションを確立する。
test('establishDevSession posts to the dev-only session endpoint and returns the session', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    calls.push({url, init});
    return Promise.resolve({
      ok: true,
      status: 201,
      json: () => Promise.resolve({authenticated: true, user: {displayName: '開発ユーザー', planCode: 'member'}})
    });
  };

  try {
    const session = await sessionApi.establishDevSession('fallback');

    assert.equal(session.authenticated, true);
    assert.equal(session.displayName, '開発ユーザー');
    assert.equal(session.planCode, 'member');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BACKEND_URL}/dev/session`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('establishDevSession throws the caller-provided message when the endpoint fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve({ok: false, status: 500, json: () => Promise.resolve({})});

  try {
    await assert.rejects(() => sessionApi.establishDevSession('fallback'), /fallback/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
