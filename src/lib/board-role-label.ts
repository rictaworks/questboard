export type BoardRoleLabelKey = 'ownerRole' | 'editorRole' | 'commenterRole' | 'viewerRole';

export function resolveRoleLabelKey(roleCode: string): BoardRoleLabelKey | null {
  switch (roleCode) {
    case 'owner':
      return 'ownerRole';
    case 'editor':
      return 'editorRole';
    case 'commenter':
      return 'commenterRole';
    case 'viewer':
      return 'viewerRole';
    default:
      return null;
  }
}
