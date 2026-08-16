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

// ---------------------------------------------------------------------------
// Resync state machine tests (Issue #59)
// ---------------------------------------------------------------------------

test('addResyncObject marks ops for that object as resyncFailed and does not touch other objects', () => {
  const state = realtime.createResyncState();
  const ops = [
    {boardId: 'b1', objectId: 'obj-1', property: 'geometry', value: {}, lamport_ts: 1, clientId: 'c1'},
    {boardId: 'b1', objectId: 'obj-2', property: 'geometry', value: {}, lamport_ts: 2, clientId: 'c1'},
  ];
  const result = realtime.addResyncObject(state, ops, 'obj-1');
  assert.equal(result.ops[0].resyncFailed, true);
  assert.equal(result.ops[1].resyncFailed, undefined);
  assert.ok(result.state.pendingObjects.has('obj-1'));
  assert.equal(result.state.pendingObjects.has('obj-2'), false);
});

test('startResyncAttempt snapshots covered objects and sets inFlight', () => {
  let state = realtime.createResyncState();
  ({state} = realtime.addResyncObject(state, [], 'obj-1'));

  const attempt = realtime.startResyncAttempt(state);
  assert.notEqual(attempt, null);
  assert.ok(attempt.coveredObjectIds.has('obj-1'));
  assert.equal(attempt.state.inFlight, true);
});

test('startResyncAttempt returns null when inFlight', () => {
  let state = realtime.createResyncState();
  ({state} = realtime.addResyncObject(state, [], 'obj-1'));
  ({state} = realtime.startResyncAttempt(state));
  // second call while inFlight
  assert.equal(realtime.startResyncAttempt(state), null);
});

test('startResyncAttempt returns null when timer is pending', () => {
  let state = realtime.createResyncState();
  ({state} = realtime.addResyncObject(state, [], 'obj-1'));
  state = realtime.recordResyncFailure(state, 42 /* fake timerId */);
  assert.equal(realtime.startResyncAttempt(state), null);
});

test('startResyncAttempt returns null when pendingObjects is empty', () => {
  const state = realtime.createResyncState();
  assert.equal(realtime.startResyncAttempt(state), null);
});

// Scenario 1: reload対象外のオブジェクトのpending opが失われないこと
test('commitResyncSuccess removes only covered object ops that are resyncFailed', () => {
  let state = realtime.createResyncState();
  const ops = [
    {boardId: 'b1', objectId: 'obj-1', property: 'geometry', value: {}, lamport_ts: 1, clientId: 'c1', resyncFailed: true},
    {boardId: 'b1', objectId: 'obj-2', property: 'geometry', value: {}, lamport_ts: 2, clientId: 'c1'},
  ];
  ({state} = realtime.addResyncObject(state, ops, 'obj-1'));
  const attempt = realtime.startResyncAttempt(state);
  state = attempt.state;

  const {state: nextState, remainingOps} = realtime.commitResyncSuccess(state, ops, attempt.coveredObjectIds);
  // obj-1's resyncFailed op should be pruned
  assert.equal(remainingOps.some((op) => op.objectId === 'obj-1' && op.resyncFailed), false);
  // obj-2's op should survive
  assert.ok(remainingOps.some((op) => op.objectId === 'obj-2'));
  assert.equal(nextState.inFlight, false);
  assert.equal(nextState.pendingObjects.has('obj-1'), false);
});

// Scenario 2: 後発オブジェクトのpending opが誤って握り潰されないこと
test('commitResyncSuccess leaves late-arriving objects in pendingObjects for the next reload', () => {
  let state = realtime.createResyncState();
  ({state} = realtime.addResyncObject(state, [], 'obj-1'));
  const attempt = realtime.startResyncAttempt(state);
  state = attempt.state;

  // obj-2 arrives while reload is in flight
  ({state} = realtime.addResyncObject(state, [], 'obj-2'));

  const {state: nextState} = realtime.commitResyncSuccess(state, [], attempt.coveredObjectIds);
  // obj-1 was covered, so it should be removed
  assert.equal(nextState.pendingObjects.has('obj-1'), false);
  // obj-2 was NOT covered by this attempt, so it must remain
  assert.ok(nextState.pendingObjects.has('obj-2'));
});

// Scenario 3: board切り替え時に状態がリセットされること
test('createResyncState always returns a clean empty state', () => {
  let state = realtime.createResyncState();
  ({state} = realtime.addResyncObject(state, [], 'obj-1'));
  const freshState = realtime.createResyncState();
  assert.equal(freshState.pendingObjects.size, 0);
  assert.equal(freshState.inFlight, false);
  assert.equal(freshState.timerId, null);
});

// Scenario 4: retry timerのcleanup後に再同期処理がブロックされないこと
test('clearResyncTimer resets timerId so subsequent startResyncAttempt can proceed', () => {
  let state = realtime.createResyncState();
  ({state} = realtime.addResyncObject(state, [], 'obj-1'));
  state = realtime.recordResyncFailure(state, 99);
  assert.equal(realtime.startResyncAttempt(state), null, 'blocked while timer pending');

  state = realtime.clearResyncTimer(state);
  assert.equal(state.timerId, null);
  assert.notEqual(realtime.startResyncAttempt(state), null, 'allowed after timer cleared');
});
