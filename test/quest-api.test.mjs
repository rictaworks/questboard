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

  // quest-api.ts の import は `import type` のみで transpile 時に消えるため require シムは不要。
  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);

  return moduleShim.exports;
}

const {QuestApiError, fetchQuests, reopenQuest, skipQuest} = await loadModule('src/lib/quest-api.ts');

const BACKEND_URL = 'https://backend.example.test';

function createFetchStub(response) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({url, init});
    return Promise.resolve(response);
  };

  return {calls, fetchImpl};
}

function jsonResponse(body, {ok = true, status = 200} = {}) {
  return {ok, status, json: () => Promise.resolve(body)};
}

test('fetchQuests sends credentials and forwards the abort signal', async () => {
  const {calls, fetchImpl} = createFetchStub(jsonResponse([]));
  const controller = new AbortController();

  await fetchQuests({backendUrl: BACKEND_URL, fetchImpl}, controller.signal);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BACKEND_URL}/quests`);
  assert.equal(calls[0].init.credentials, 'include');
  // signal を転送しないと invalidateQueries の cancelRefetch が実際のリクエストを
  // 中断できず、古い応答が新しい応答を追い越しうる。
  assert.equal(calls[0].init.signal, controller.signal);
});

test('fetchQuests returns the parsed snapshot array', async () => {
  const snapshots = [{id: 'a', title: 'a', state: 'completed', progress: 1, conditionCount: 1}];
  const {fetchImpl} = createFetchStub(jsonResponse(snapshots));

  const result = await fetchQuests({backendUrl: BACKEND_URL, fetchImpl});

  assert.deepEqual(result, snapshots);
});

test('fetchQuests throws QuestApiError with the status instead of falling back silently', async () => {
  const {fetchImpl} = createFetchStub(jsonResponse(null, {ok: false, status: 401}));

  await assert.rejects(
    () => fetchQuests({backendUrl: BACKEND_URL, fetchImpl}),
    (error) => {
      assert.ok(error instanceof QuestApiError);
      assert.equal(error.status, 401);
      return true;
    }
  );
});

test('fetchQuests rejects a non-array body rather than handing it to the cache', async () => {
  const {fetchImpl} = createFetchStub(jsonResponse({error: 'unexpected shape'}));

  await assert.rejects(
    () => fetchQuests({backendUrl: BACKEND_URL, fetchImpl}),
    (error) => error instanceof QuestApiError
  );
});

test('skipQuest and reopenQuest post the url-encoded quest id with the share token', async () => {
  for (const [action, call] of [['skip', skipQuest], ['reopen', reopenQuest]]) {
    const {calls, fetchImpl} = createFetchStub(jsonResponse({success: true}));

    await call('付箋を3枚作る', {
      backendUrl: BACKEND_URL,
      shareToken: 'share-token-1',
      fetchImpl,
    });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      `${BACKEND_URL}/quests/${encodeURIComponent('付箋を3枚作る')}/${action}`
    );
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.credentials, 'include');
    assert.deepEqual(JSON.parse(calls[0].init.body), {share_token: 'share-token-1'});
  }
});

test('a failed mutation surfaces QuestApiError so the UI can report it', async () => {
  const {fetchImpl} = createFetchStub(jsonResponse(null, {ok: false, status: 422}));

  await assert.rejects(
    () => skipQuest('a', {backendUrl: BACKEND_URL, shareToken: 't', fetchImpl}),
    (error) => {
      assert.ok(error instanceof QuestApiError);
      assert.equal(error.status, 422);
      return true;
    }
  );
});

test('mutations never return the server snapshot, so it cannot be written into the cache', async () => {
  // 応答をキャッシュへ書き戻すと GET とミューテーションで書き手が2つになり、
  // 「reopen 応答の後に古い GET が届いて巻き戻る」順序逆転が復活する（PR #61 レビュー）。
  const {fetchImpl} = createFetchStub(jsonResponse({success: true, snapshot: {id: 'a', state: 'skipped'}}));

  const result = await skipQuest('a', {backendUrl: BACKEND_URL, shareToken: 't', fetchImpl});

  assert.equal(result, undefined);
});
