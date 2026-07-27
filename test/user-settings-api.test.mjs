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

const {UserSettingsApiError, fetchUserSettings, updateUserSettings} = await loadModule('src/lib/user-settings-api.ts');

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

test('fetchUserSettings sends credentials and forwards the abort signal', async () => {
  const {calls, fetchImpl} = createFetchStub(jsonResponse({intensity: 'full'}));
  const controller = new AbortController();

  await fetchUserSettings({backendUrl: BACKEND_URL, fetchImpl}, controller.signal);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BACKEND_URL}/user_settings`);
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.signal, controller.signal);
});

test('fetchUserSettings returns the parsed intensity snapshot', async () => {
  const {fetchImpl} = createFetchStub(jsonResponse({intensity: 'subtle'}));

  const result = await fetchUserSettings({backendUrl: BACKEND_URL, fetchImpl});

  assert.deepEqual(result, {intensity: 'subtle'});
});

test('updateUserSettings patches the intensity payload', async () => {
  const {calls, fetchImpl} = createFetchStub(jsonResponse({intensity: 'off'}));

  const result = await updateUserSettings({backendUrl: BACKEND_URL, fetchImpl}, 'off');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BACKEND_URL}/user_settings`);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].init.body), {intensity: 'off'});
  assert.deepEqual(result, {intensity: 'off'});
});

test('user settings API errors surface the HTTP status instead of falling back silently', async () => {
  const {fetchImpl} = createFetchStub(jsonResponse(null, {ok: false, status: 422}));

  await assert.rejects(
    () => updateUserSettings({backendUrl: BACKEND_URL, fetchImpl}, 'full'),
    (error) => {
      assert.ok(error instanceof UserSettingsApiError);
      assert.equal(error.status, 422);
      return true;
    }
  );
});
