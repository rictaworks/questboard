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

export default function BoardUserMenu({displayName, onSignOut, roleCode}: BoardUserMenuProps) {
  const t = useTranslations('BoardCanvas');
  const roleLabelKey = resolveRoleLabelKey(roleCode);
  const resolvedDisplayName = displayName.trim() || t('unknownUser');
  const resolvedRoleLabel = roleLabelKey ? t(roleLabelKey) : roleCode;

  return (
    <details className="board-user-menu">
      <summary className="board-user-menu-trigger" aria-label={resolvedDisplayName} title={resolvedDisplayName}>
        <FontAwesomeIcon icon={faUser} className="board-user-menu-avatar" />
        <FontAwesomeIcon icon={faChevronDown} className="board-user-menu-chevron" />
      </summary>
      <div className="board-user-menu-panel">
        <p className="board-user-menu-panel-name">
          <FontAwesomeIcon icon={faUser} />
          <span>{resolvedDisplayName}</span>
        </p>
        <p className="board-user-menu-panel-role">{resolvedRoleLabel}</p>
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
