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

const {createSerialAsyncQueue} = await loadModule('src/lib/serial-async-queue.ts');

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });

  return {promise, resolve};
}

test('createSerialAsyncQueue waits for each update before starting the next one', async () => {
  const starts = [];
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const queue = createSerialAsyncQueue((value) => {
    starts.push(value);
    return value === 'full' ? first.promise : value === 'subtle' ? second.promise : third.promise;
  });

  const firstRun = queue('full');
  const secondRun = queue('subtle');
  const thirdRun = queue('off');

  await Promise.resolve();
  assert.deepEqual(starts, ['full']);

  first.resolve();
  await firstRun;
  await Promise.resolve();
  assert.deepEqual(starts, ['full', 'subtle']);

  second.resolve();
  await secondRun;
  await Promise.resolve();
  assert.deepEqual(starts, ['full', 'subtle', 'off']);

  third.resolve();
  await thirdRun;
});
