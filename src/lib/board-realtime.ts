export interface BoardCanvasObjectLike {
  id: number;
  geometry: {x: number; y: number; w: number; h: number; rotation: number};
  colorId: number;
  deletedAt?: string | null;
  locked: boolean;
  lockedByUserId?: number | null;
  lockOriginObjectId?: number | null;
}

export interface BoardCanvasDataLike {
  board: {id: number; title: string; shareToken: string};
  membership: {userId: number; role: {id: number; code: string}};
  objectTypes: Array<{id: number; code: string}>;
  colorPalettes: Array<{id: number; hex: string}>;
  objects: BoardCanvasObjectLike[];
  comments: Array<unknown>;
}

export interface BoardRealtimeOp {
  boardId: string;
  objectId: string;
  property: string;
  value: unknown;
  lamport_ts: number;
  clientId: string;
  duplicate?: boolean;
  resyncFailed?: boolean;
}

export interface BoardPresenceCursor {
  x: number;
  y: number;
}

export interface BoardPresenceValue {
  cursor: BoardPresenceCursor;
  displayName?: string;
}

export interface BoardPresenceMessage extends BoardRealtimeOp {
  property: 'presence';
  value: BoardPresenceValue;
}

export interface BoardRestoreSuggestion {
  objectId: string;
  error: string;
  restoreSuggested: true;
}

export interface BoardResyncRequired {
  objectId: string;
  error: string;
  resyncRequired: true;
}

export function readRealtimeSettings() {
  const syncServerUrl = process.env.NEXT_PUBLIC_SYNC_SERVER_URL;

  if (!syncServerUrl) {
    throw new Error('NEXT_PUBLIC_SYNC_SERVER_URL is required');
  }

  return {syncServerUrl};
}

export function buildSyncWebSocketUrl(syncServerUrl: string, boardId: string) {
  const url = new URL(syncServerUrl);
  if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  }

  url.pathname = '/ws';
  url.search = '';
  url.searchParams.set('boardId', boardId);
  return url.toString();
}

export function createPresenceValue(cursor: BoardPresenceCursor, displayName?: string): BoardPresenceValue {
  return displayName ? {cursor, displayName} : {cursor};
}

export function parseRealtimeMessage(raw: string): BoardRealtimeOp | BoardPresenceMessage | BoardRestoreSuggestion | BoardResyncRequired | null {
  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(payload)) {
    return null;
  }

  if (payload.restoreSuggested === true && typeof payload.objectId === 'string' && typeof payload.error === 'string') {
    return {
      objectId: payload.objectId,
      error: payload.error,
      restoreSuggested: true,
    };
  }

  if (payload.resyncRequired === true && typeof payload.objectId === 'string' && typeof payload.error === 'string') {
    return {
      objectId: payload.objectId,
      error: payload.error,
      resyncRequired: true,
    };
  }

  if (payload.property === 'presence') {
    const presenceValue = parsePresenceValue(payload.value);
    const lamport_ts = numberValue(payload.lamport_ts);
    if (!presenceValue) {
      return null;
    }
    if (lamport_ts == null) {
      return null;
    }

    return {
      boardId: stringValue(payload.boardId),
      objectId: stringValue(payload.objectId),
      property: 'presence',
      value: presenceValue,
      lamport_ts,
      clientId: stringValue(payload.clientId),
      duplicate: booleanValue(payload.duplicate),
    };
  }

  const boardId = stringValue(payload.boardId);
  const objectId = stringValue(payload.objectId);
  const property = stringValue(payload.property);
  const value = recordValue(payload.value);
  const lamport_ts = numberValue(payload.lamport_ts);
  const clientId = stringValue(payload.clientId);

  if (!boardId || !objectId || !property || value == null || !clientId || lamport_ts == null) {
    return null;
  }

  return {
    boardId,
    objectId,
    property,
    value,
    lamport_ts,
    clientId,
    duplicate: booleanValue(payload.duplicate),
  };
}

export function applyRealtimeOp<T extends BoardCanvasDataLike>(boardData: T, op: BoardRealtimeOp): T {
  if (op.property !== 'geometry' && op.property !== 'color' && op.property !== 'deleted_at') {
    return boardData;
  }

  const opValue = isRecord(op.value) ? op.value : {};

  const objects = boardData.objects.map((object) => {
    if (String(object.id) !== op.objectId) {
      return object;
    }

    if (op.property === 'geometry') {
      return {
        ...object,
        geometry: mergeGeometry(object.geometry, opValue),
      };
    }

    if (op.property === 'color') {
      return {
        ...object,
        colorId: numberValue(opValue['color_id']) ?? object.colorId,
      };
    }

    if (isRestoreValue(op.value)) {
      return {
        ...object,
        deletedAt: null,
      };
    }

    if (object.deletedAt != null) {
      return object;
    }

    return {
      ...object,
      deletedAt: new Date().toISOString(),
    };
  });

  return {
    ...boardData,
    objects,
  };
}

export function isNewerRealtimeOp(candidate: BoardRealtimeOp, current: BoardRealtimeOp) {
  if (candidate.lamport_ts !== current.lamport_ts) {
    return candidate.lamport_ts > current.lamport_ts;
  }

  return candidate.clientId < current.clientId;
}

// ボード取得レスポンスの lamportTs までクライアントの Lamport カウンタを進める。
// 初回ロードと resync 後の再取得の両方で使う。
//
// - 巻き戻さない（Math.max）。既に送信済みの op より小さい値を採番すると、
//   自分の次の編集がサーバーの LWW 判定で stale として拒否される。
// - lamportTs 欠落・非数値・負値は 0 として扱う。0 から採番すると、op 履歴のある
//   プロパティへの最初の N 回の編集がすべて拒否される（Issue #86）。
export function resumeLamportTs(current: number, serverLamportTs: unknown): number {
  const parsed = typeof serverLamportTs === 'number' && Number.isFinite(serverLamportTs)
    ? Math.floor(serverLamportTs)
    : 0;

  return Math.max(current, parsed, 0);
}

export function opKey(op: BoardRealtimeOp) {
  return [op.boardId, op.objectId, op.property, op.lamport_ts, op.clientId, JSON.stringify(op.value)].join(':');
}

function mergeGeometry(
  current: BoardCanvasObjectLike['geometry'],
  next: Record<string, unknown>
): BoardCanvasObjectLike['geometry'] {
  return {
    x: numberValue(next.x) ?? current.x,
    y: numberValue(next.y) ?? current.y,
    w: numberValue(next.w) ?? current.w,
    h: numberValue(next.h) ?? current.h,
    rotation: numberValue(next.rotation) ?? current.rotation,
  };
}

function parsePresenceValue(value: unknown): BoardPresenceValue | null {
  if (!isRecord(value) || !isRecord(value.cursor)) {
    return null;
  }

  const x = numberValue(value.cursor.x);
  const y = numberValue(value.cursor.y);
  const hasDisplayName = Object.prototype.hasOwnProperty.call(value, 'displayName');
  if (hasDisplayName && typeof value.displayName !== 'string') {
    return null;
  }
  const displayName: string | undefined = hasDisplayName ? (value.displayName as string) : undefined;

  if (x == null || y == null) {
    return null;
  }

  if (displayName === undefined) {
    return {cursor: {x, y}};
  }

  return {cursor: {x, y}, displayName};
}

function isRestoreValue(value: unknown) {
  return isRecord(value) && value.restore === true;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// ---------------------------------------------------------------------------
// Resync state machine – pure helpers extracted from board-canvas-panel.tsx
// ---------------------------------------------------------------------------

export interface ResyncState {
  /** Object IDs that are waiting to be re-fetched from the server. */
  pendingObjects: Set<string>;
  /** True while an in-flight reload() promise is outstanding. */
  inFlight: boolean;
  /** Non-null while a backoff timer is scheduled. */
  timerId: number | null;
}

export function createResyncState(): ResyncState {
  return {pendingObjects: new Set(), inFlight: false, timerId: null};
}

/**
 * Mark an object as needing resync.  Returns the next state.
 * Marks any ops for that object as resyncFailed so they are not re-sent.
 */
export function addResyncObject(
  state: ResyncState,
  pendingOps: BoardRealtimeOp[],
  objectId: string,
): {state: ResyncState; ops: BoardRealtimeOp[]} {
  const nextOps = pendingOps.map((op) =>
    op.objectId === objectId ? {...op, resyncFailed: true} : op,
  );
  return {
    state: {...state, pendingObjects: new Set([...state.pendingObjects, objectId])},
    ops: nextOps,
  };
}

/**
 * Called when we are about to fire the reload() call.
 * Returns the set of object IDs this attempt will cover (snapshot), plus
 * the updated state with inFlight=true.
 * Returns null when the attempt should be skipped (already in flight,
 * timer pending, or nothing to reload).
 */
export function startResyncAttempt(state: ResyncState): {
  coveredObjectIds: Set<string>;
  state: ResyncState;
} | null {
  if (state.inFlight || state.timerId !== null || state.pendingObjects.size === 0) {
    return null;
  }
  const coveredObjectIds = new Set(state.pendingObjects);
  return {
    coveredObjectIds,
    state: {...state, inFlight: true},
  };
}

/**
 * Called after a successful reload().  Removes covered objects and
 * clears the in-flight flag.
 * Returns updated state and the ops that should be pruned (resyncFailed ops
 * for covered objects).
 */
export function commitResyncSuccess(
  state: ResyncState,
  pendingOps: BoardRealtimeOp[],
  coveredObjectIds: Set<string>,
): {state: ResyncState; prunedOps: BoardRealtimeOp[]; remainingOps: BoardRealtimeOp[]} {
  const nextPending = new Set(state.pendingObjects);
  coveredObjectIds.forEach((id) => nextPending.delete(id));
  const prunedOps = pendingOps.filter(
    (op) => coveredObjectIds.has(op.objectId) && op.resyncFailed === true,
  );
  const remainingOps = pendingOps.filter(
    (op) => !(coveredObjectIds.has(op.objectId) && op.resyncFailed === true),
  );
  return {
    state: {...state, inFlight: false, pendingObjects: nextPending},
    prunedOps,
    remainingOps,
  };
}

/**
 * Called when a reload() attempt fails.  Clears inFlight and records the
 * timer ID so callers know a backoff is active.
 */
export function recordResyncFailure(
  state: ResyncState,
  timerId: number | null,
): ResyncState {
  return {...state, inFlight: false, timerId};
}

/**
 * Called when the backoff timer fires.  Clears the timerId so the next
 * startResyncAttempt is allowed to proceed.
 */
export function clearResyncTimer(state: ResyncState): ResyncState {
  return {...state, timerId: null};
}
