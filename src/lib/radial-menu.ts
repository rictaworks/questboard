import {canPerformBoardAction, type BoardObjectLockState, type BoardRoleCode} from './board-permissions';

// モック（app-ui/Questboard Prototype.dc.html）のラジアルメニューで空白から
// 作成できる4種。connector / image はモックのラジアルに存在せず、生成後の
// 操作導線が未設計のため現段階では含めない（issue #192 設計書 3.5）。
export const RADIAL_CREATE_TYPE_CODES = ['sticky', 'shape', 'text', 'frame'] as const;

export interface RadialMenuTargetObject extends BoardObjectLockState {
  objectId: number;
  // フレームロックの継承を判定するため。ロック元オブジェクトの id（自分自身なら直接ロック）。
  lockOriginObjectId?: number | null;
}

export type RadialMenuItem =
  | {key: `create-${string}`; kind: 'create'; objectTypeCode: string; labelKey: string}
  | {key: 'color'; kind: 'color'; labelKey: string}
  | {key: 'duplicate'; kind: 'duplicate'; labelKey: string}
  | {key: 'lock'; kind: 'lock'; labelKey: string}
  | {key: 'unlock'; kind: 'unlock'; labelKey: string}
  | {key: 'delete'; kind: 'delete'; labelKey: string}
  | {key: 'comment'; kind: 'comment'; labelKey: string};

export interface RadialMenuInput {
  roleCode: BoardRoleCode;
  currentUserId: number;
  // null は空白（キャンバス背景）を指す
  target: RadialMenuTargetObject | null;
  // バックエンドが返す objectTypes の code 一覧。存在しない種別は出さない。
  objectTypeCodes: readonly string[];
}

const CREATE_LABEL_KEYS: Record<string, string> = {
  frame: 'objectTypeFrame',
  shape: 'objectTypeShape',
  sticky: 'objectTypeSticky',
  text: 'objectTypeText',
};

// ロール・ロック状態・対象（空白/オブジェクト）からラジアルメニューの項目列を
// 組み立てる。権限判定は board-permissions の canPerformBoardAction に一元化し、
// この関数は「どの操作をどの順で見せるか」だけを持つ。
// 空配列は「メニューを開かず、呼び出し側が権限トーストを出す」ことを意味する。
export function buildRadialMenuItems(input: RadialMenuInput): RadialMenuItem[] {
  const {roleCode, currentUserId, target, objectTypeCodes} = input;

  if (target === null) {
    if (!canPerformBoardAction(roleCode, 'create', null, currentUserId)) {
      return [];
    }

    return RADIAL_CREATE_TYPE_CODES
      .filter((code) => objectTypeCodes.includes(code))
      .map((code) => ({
        key: `create-${code}` as const,
        kind: 'create' as const,
        objectTypeCode: code,
        labelKey: CREATE_LABEL_KEYS[code],
      }));
  }

  const lockState: BoardObjectLockState = target;
  const items: RadialMenuItem[] = [];

  if (canPerformBoardAction(roleCode, 'recolor', lockState, currentUserId)) {
    items.push({key: 'color', kind: 'color', labelKey: 'radialColor'});
  }
  if (canPerformBoardAction(roleCode, 'duplicate', lockState, currentUserId)) {
    items.push({key: 'duplicate', kind: 'duplicate', labelKey: 'duplicate'});
  }
  // フレームロックの継承先（lockOriginObjectId が自分以外）は、ロック元でしか
  // 解除できないため lock/unlock ボタン自体を出さない（board-canvas-panel の
  // toggleLock と同じ判定）。
  const isInheritedLock =
    target.locked && target.lockOriginObjectId != null && target.lockOriginObjectId !== target.objectId;
  if (!isInheritedLock) {
    if (!target.locked && canPerformBoardAction(roleCode, 'lock', lockState, currentUserId)) {
      items.push({key: 'lock', kind: 'lock', labelKey: 'radialLock'});
    }
    if (target.locked && canPerformBoardAction(roleCode, 'unlock', lockState, currentUserId)) {
      items.push({key: 'unlock', kind: 'unlock', labelKey: 'radialUnlock'});
    }
  }
  if (canPerformBoardAction(roleCode, 'delete', lockState, currentUserId)) {
    items.push({key: 'delete', kind: 'delete', labelKey: 'delete'});
  }
  if (roleCode !== 'viewer') {
    items.push({key: 'comment', kind: 'comment', labelKey: 'commentsHeading'});
  }

  return items;
}

// 他者ロック中のオブジェクトを開いたときに出す注記（モックの
// 「ロック中：ownerのみ編集可」）を出すかどうか。
export function shouldShowLockedNote(input: RadialMenuInput): boolean {
  const {target, roleCode, currentUserId} = input;
  if (target === null || !target.locked) {
    return false;
  }

  return !canPerformBoardAction(roleCode, 'move', target, currentUserId);
}
