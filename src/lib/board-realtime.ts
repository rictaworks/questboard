import {resolveBackendUrl} from "@/lib/backend-url";
import {composeCrdt, type TextCrdtDiffOp, type TextCrdtState} from "@/lib/text-crdt";

export interface BoardCanvasObjectLike {
  id: number;
  geometry: {x: number; y: number; w: number; h: number; rotation: number};
  colorId: number;
  deletedAt?: string | null;
  locked: boolean;
  lockedByUserId?: number | null;
  lockOriginObjectId?: number | null;
  textCrdt?: TextCrdtState;
  textCrdtRevision?: number | null;
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

export interface BoardResyncState {
  pendingOps: BoardRealtimeOp[];
  resyncingObjects: Set<string>;
}

export function readRealtimeSettings() {
  // backendUrl（REST API）と同じ問題：Codespacesの転送URL越しに実ブラウザで開くと
  // ws://localhost:8080 は開発者の手元マシンを指してしまい繋がらない。resolveBackendUrl
  // は本番では何もせず設定値をそのまま返すため、Sync-serverのURLにも安全に使い回せる
  // （src/lib/backend-url.ts）。https/httpで返った結果はbuildSyncWebSocketUrlが
  // wss/wsへ変換する。
  const syncServerUrl = resolveBackendUrl(process.env.NEXT_PUBLIC_SYNC_SERVER_URL);

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
  if (op.property !== 'geometry' && op.property !== 'color' && op.property !== 'deleted_at' && op.property !== 'text_crdt') {
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

    if (op.property === 'text_crdt') {
      // value.ops は差分（retain/delete/insert）。ローカルの run リストへ合成し、
      // ack/broadcast が運ぶ revision（そのopのObjectOp id）で ref_revision の
      // 追従先を更新する（次の編集の OT 基準になる。issue #199）
      const diffOps = Array.isArray(opValue['ops']) ? (opValue['ops'] as TextCrdtDiffOp[]) : [];
      if (diffOps.length === 0) {
        return object;
      }

      return {
        ...object,
        textCrdt: composeCrdt(object.textCrdt, diffOps),
        textCrdtRevision: numberValue(opValue['revision']) ?? object.textCrdtRevision ?? null,
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

export function markResyncRequired(state: BoardResyncState, objectId: string): BoardResyncState {
  return {
    pendingOps: state.pendingOps.map((pending) => (
      pending.objectId === objectId
        ? {...pending, resyncFailed: true}
        : pending
    )),
    resyncingObjects: new Set(state.resyncingObjects).add(objectId),
  };
}

export function settleResyncReload(
  state: BoardResyncState,
  coveredObjectIds: Set<string>
): BoardResyncState & {shouldReloadAgain: boolean} {
  const resyncingObjects = new Set(state.resyncingObjects);
  coveredObjectIds.forEach((objectId) => {
    resyncingObjects.delete(objectId);
  });

  return {
    pendingOps: state.pendingOps.filter((pending) => (
      !coveredObjectIds.has(pending.objectId) || pending.resyncFailed !== true
    )),
    resyncingObjects,
    shouldReloadAgain: resyncingObjects.size > 0,
  };
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
