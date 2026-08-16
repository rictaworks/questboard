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
  assert.equal(realtime.isNewerRealtimeOp({...older, clientId: 'a'}, sameLamport), true);
  assert.equal(realtime.isNewerRealtimeOp(sameLamport, older), false);
});

test('parseRealtimeMessage accepts a payload-free quest_state_changed signal but rejects a null value', () => {
  const base = {
    boardId: 'board-1',
    objectId: '42',
    property: 'quest_state_changed',
    lamport_ts: 7,
    clientId: 'system',
  };

  // サーバーは個人データを載せない空オブジェクトを送る。これが受理されないと
  // クエスト通知がハンドラまで届かず、ポーリング待ちになる（PR #61 レビュー）。
  const accepted = realtime.parseRealtimeMessage(JSON.stringify({...base, value: {}}));
  assert.notEqual(accepted, null);
  assert.equal(accepted.property, 'quest_state_changed');
  assert.equal(accepted.objectId, '42');
  assert.deepEqual(accepted.value, {});

  // value: null は従来どおり捨てる。このガードは applyRealtimeOp も守っているため緩めない。
  assert.equal(realtime.parseRealtimeMessage(JSON.stringify({...base, value: null})), null);
});

test('resumeLamportTs resumes the client counter from the board-wide lamport_ts', () => {
  // 再読み込み直後は 0 スタート。サーバーが返した最大値まで一気に進める。
  // ここで 0 のままだと、op 履歴のあるプロパティへの最初の N 回の編集が
  // サーバーの LWW 判定で拒否され、操作が巻き戻る（Issue #86）。
  assert.equal(realtime.resumeLamportTs(0, 12), 12);

  // 既に自分が進めたカウンタは巻き戻さない。巻き戻すと自分の次の op が stale になる。
  assert.equal(realtime.resumeLamportTs(30, 12), 30);

  // lamportTs を返さない古いサーバー応答・不正値でも例外にせず現在値を保つ。
  assert.equal(realtime.resumeLamportTs(5, undefined), 5);
  assert.equal(realtime.resumeLamportTs(5, null), 5);
  assert.equal(realtime.resumeLamportTs(5, 'abc'), 5);
  assert.equal(realtime.resumeLamportTs(5, Number.NaN), 5);
  assert.equal(realtime.resumeLamportTs(5, -1), 5);
  assert.equal(realtime.resumeLamportTs(0, -1), 0);

  // 小数は切り捨てる。lamport_ts は整数であることをサーバーが検証している。
  assert.equal(realtime.resumeLamportTs(0, 7.9), 7);
});

test('markResyncRequired preserves unrelated pending ops and settleResyncReload only clears covered objects', () => {
  const pendingA = {
    boardId: 'board-1',
    objectId: 'object-a',
    property: 'geometry',
    value: {x: 1},
    lamport_ts: 1,
    clientId: 'client-a',
  };
  const pendingB = {
    ...pendingA,
    objectId: 'object-b',
    lamport_ts: 2,
  };

  const afterResyncRequired = realtime.markResyncRequired(
    {
      pendingOps: [pendingA, pendingB],
      resyncingObjects: new Set(['object-a']),
    },
    'object-b'
  );

  assert.equal(afterResyncRequired.pendingOps[0].resyncFailed, undefined);
  assert.equal(afterResyncRequired.pendingOps[1].resyncFailed, true);
  assert.deepEqual([...afterResyncRequired.resyncingObjects].sort(), ['object-a', 'object-b']);

  const afterCoveredReload = realtime.settleResyncReload(
    afterResyncRequired,
    new Set(['object-a'])
  );

  assert.equal(afterCoveredReload.pendingOps.length, 2);
  assert.equal(afterCoveredReload.pendingOps[0].objectId, 'object-a');
  assert.equal(afterCoveredReload.pendingOps[0].resyncFailed, undefined);
  assert.equal(afterCoveredReload.pendingOps[1].objectId, 'object-b');
  assert.equal(afterCoveredReload.pendingOps[1].resyncFailed, true);
  assert.deepEqual([...afterCoveredReload.resyncingObjects], ['object-b']);
  assert.equal(afterCoveredReload.shouldReloadAgain, true);

  const finalState = realtime.settleResyncReload(
    afterCoveredReload,
    new Set(['object-b'])
  );

  assert.equal(finalState.pendingOps.length, 1);
  assert.equal(finalState.pendingOps[0].objectId, 'object-a');
  assert.equal(finalState.pendingOps[0].resyncFailed, undefined);
  assert.deepEqual([...finalState.resyncingObjects], []);
  assert.equal(finalState.shouldReloadAgain, false);
});
