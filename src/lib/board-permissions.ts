export type BoardRoleCode = 'owner' | 'editor' | 'commenter' | 'viewer';
export type BoardAction =
  | 'view'
  | 'create'
  | 'move'
  | 'resize'
  | 'rotate'
  | 'delete'
  | 'restore'
  | 'duplicate'
  | 'recolor'
  | 'lock'
  | 'unlock';

export interface BoardObjectLockState {
  locked: boolean;
  lockedByUserId?: number | null;
}

export type BoardRealtimeObjectProperty = 'geometry' | 'color' | 'deleted_at';

export function resolveBoardActionForObjectMutation(
  property: BoardRealtimeObjectProperty,
  value: Record<string, unknown> = {}
): Exclude<BoardAction, 'view' | 'create' | 'duplicate' | 'lock' | 'unlock'> {
  if (property === 'deleted_at') {
    return value.restore === true ? 'restore' : 'delete';
  }

  return property === 'geometry' ? 'move' : 'recolor';
}

export function canPerformBoardAction(
  roleCode: BoardRoleCode | string,
  action: BoardAction,
  objectState: BoardObjectLockState | null = null,
  currentUserId?: number | null
): boolean {
  if (roleCode === 'owner') {
    return true;
  }

  if (action === 'view') {
    return roleCode === 'editor' || roleCode === 'commenter' || roleCode === 'viewer';
  }

  if (roleCode === 'viewer') {
    return false;
  }

  if (roleCode === 'commenter') {
    return false;
  }

  const locked = objectState?.locked ?? false;
  const lockedByUserId = objectState?.lockedByUserId ?? null;
  const lockHeldByCurrentUser = locked && lockedByUserId != null && currentUserId != null && lockedByUserId === currentUserId;

  if (action === 'lock') {
    return !locked;
  }

  if (action === 'unlock') {
    return locked && lockHeldByCurrentUser;
  }

  return !locked || lockHeldByCurrentUser;
}
