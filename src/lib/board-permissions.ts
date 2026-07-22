export type BoardRoleCode = 'owner' | 'editor' | 'commenter' | 'viewer';
export type BoardAction =
  | 'view'
  | 'create'
  | 'move'
  | 'resize'
  | 'rotate'
  | 'delete'
  | 'duplicate'
  | 'recolor'
  | 'lock'
  | 'unlock';

export interface BoardObjectLockState {
  locked: boolean;
  lockedByUserId?: number | null;
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

  if (action === 'create') {
    return !locked || lockHeldByCurrentUser;
  }

  return !locked || lockHeldByCurrentUser;
}
