import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function loadBoardRealtimeModule() {
  const source = await read('src/lib/board-realtime.ts');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const realtime = await loadBoardRealtimeModule();

test('buildSyncWebSocketUrl rewrites the protocol and adds the board id', () => {
  const url = realtime.buildSyncWebSocketUrl('https://sync.example.test', 'board-123');

  assert.equal(url, 'wss://sync.example.test/ws?boardId=board-123');
});

test('parseRealtimeMessage keeps presence display names and restore suggestions', () => {
  const presence = realtime.parseRealtimeMessage(JSON.stringify({
    boardId: 'board-1',
    objectId: 'presence-1',
    property: 'presence',
    value: {cursor: {x: 12, y: 34}, displayName: 'Ada Lovelace'},
    lamport_ts: 3,
    clientId: 'client-a',
  }));
  assert.equal(presence.value.displayName, 'Ada Lovelace');
  assert.deepEqual(presence.value.cursor, {x: 12, y: 34});

  const restore = realtime.parseRealtimeMessage(JSON.stringify({
    objectId: 'object-9',
    error: 'Object has been deleted; restore it before editing',
    restoreSuggested: true,
  }));
  assert.deepEqual(restore, {
    objectId: 'object-9',
    error: 'Object has been deleted; restore it before editing',
    restoreSuggested: true,
  });
});

test('applyRealtimeOp converges geometry, color, delete, and restore changes', () => {
  const board = {
    board: {id: 1, title: 'Board', shareToken: 'board-1'},
    membership: {userId: 1, role: {id: 1, code: 'editor'}},
    objectTypes: [],
    colorPalettes: [{id: 2, hex: '#111111'}],
    objects: [
      {id: 9, geometry: {x: 1, y: 2, w: 3, h: 4, rotation: 0}, colorId: 1, deletedAt: null, locked: false}
    ],
    comments: [],
  };

  const moved = realtime.applyRealtimeOp(board, {
    boardId: 'board-1',
    objectId: '9',
    property: 'geometry',
    value: {x: 10, y: 20},
    lamport_ts: 1,
    clientId: 'client-a',
  });
  assert.deepEqual(moved.objects[0].geometry, {x: 10, y: 20, w: 3, h: 4, rotation: 0});

  const recolored = realtime.applyRealtimeOp(moved, {
    boardId: 'board-1',
    objectId: '9',
    property: 'color',
    value: {color_id: 2},
    lamport_ts: 2,
    clientId: 'client-a',
  });
  assert.equal(recolored.objects[0].colorId, 2);

  const deleted = realtime.applyRealtimeOp(recolored, {
    boardId: 'board-1',
    objectId: '9',
    property: 'deleted_at',
    value: {},
    lamport_ts: 3,
    clientId: 'client-a',
  });
  assert.equal(deleted.objects[0].deletedAt != null, true);

  const restored = realtime.applyRealtimeOp(deleted, {
    boardId: 'board-1',
    objectId: '9',
    property: 'deleted_at',
    value: {restore: true},
    lamport_ts: 4,
    clientId: 'client-a',
  });
  assert.equal(restored.objects[0].deletedAt, null);
});

test('isNewerRealtimeOp compares Lamport timestamps then client ids', () => {
  const older = {
    boardId: 'board-1',
    objectId: '9',
    property: 'geometry',
    value: {x: 1},
    lamport_ts: 1,
    clientId: 'a',
  };
  const newer = {...older, lamport_ts: 2};
  const sameLamport = {...older, clientId: 'b'};

  assert.equal(realtime.isNewerRealtimeOp(newer, older), true);
  assert.equal(realtime.isNewerRealtimeOp(sameLamport, older), true);
  assert.equal(realtime.isNewerRealtimeOp(older, sameLamport), false);
});
