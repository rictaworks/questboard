"use client";

import {faChevronDown, faRightFromBracket, faUser} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {useTranslations} from 'next-intl';

import type {BoardRoleCode} from '@/lib/board-permissions';
import {resolveRoleLabelKey} from '@/lib/board-role-label';

type BoardUserMenuProps = {
  displayName: string;
  onSignOut?: () => void;
  roleCode: BoardRoleCode;
};

function resolveAvatarGlyph(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return '?';
  }

  return Array.from(trimmed)[0]?.toUpperCase() ?? '?';
}

export default function BoardUserMenu({displayName, onSignOut, roleCode}: BoardUserMenuProps) {
  const t = useTranslations('BoardCanvas');
  const roleLabelKey = resolveRoleLabelKey(roleCode);
  const resolvedDisplayName = displayName.trim() || t('unknownUser');
  const avatarGlyph = resolveAvatarGlyph(resolvedDisplayName);

  return (
    <details className="board-user-menu">
      <summary className="board-user-menu-trigger" title={resolvedDisplayName}>
        <span className="board-user-menu-avatar" aria-hidden="true">
          {avatarGlyph}
        </span>
        <span className="board-user-menu-copy">
          <strong className="board-user-menu-name">{resolvedDisplayName}</strong>
          <span className="board-user-menu-role">{roleLabelKey ? t(roleLabelKey) : roleCode}</span>
        </span>
        <FontAwesomeIcon icon={faChevronDown} className="board-user-menu-chevron" />
      </summary>
      <div className="board-user-menu-panel">
        <p className="board-user-menu-panel-name">
          <FontAwesomeIcon icon={faUser} />
          <span>{resolvedDisplayName}</span>
        </p>
        <p className="board-user-menu-panel-role">{roleLabelKey ? t(roleLabelKey) : roleCode}</p>
        {onSignOut ? (
          <button className="button button-secondary board-user-menu-sign-out" type="button" onClick={onSignOut}>
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>{t('signOut')}</span>
          </button>
        ) : null}
      </div>
    </details>
  );
}
