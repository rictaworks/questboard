"use client";

import {faListCheck, faRotate} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import Link from 'next/link';
import type {ReactNode} from 'react';
import {useTranslations} from 'next-intl';

import {resolveRoleLabelKey} from '@/lib/board-role-label';
import {resolveAvatarRoster, type AvatarParticipant} from '@/lib/presence-avatar';
import {FEEDBACK_INTENSITY_MASTERS, type FeedbackIntensityCode} from '@/lib/feedback-director';
import type {BoardRoleCode} from '@/lib/board-permissions';

// モック（app-ui/Questboard Prototype.dc.html）の上部バー（64px）。
// ロゴ＋ワードマーク／ボードタイトル／ロール表示／演出強度切替／参加者アバター／
// 同期状態／クエスト再表示／再読み込み／ユーザーメニューを横一列に集約する。
// ロールはモックと違い切替ボタンではなく表示のみ（実機のロールは membership 由来）。

const INTENSITY_LABEL_KEYS: Record<FeedbackIntensityCode, string> = {
  full: 'intensityFull',
  subtle: 'intensitySubtle',
  off: 'intensityOff',
};

type SyncStatusCode = 'connecting' | 'connected' | 'reconnecting' | 'offline';

const SYNC_STATUS_LABEL_KEYS: Record<SyncStatusCode, string> = {
  connected: 'connectionConnected',
  connecting: 'connectionConnecting',
  offline: 'connectionOffline',
  reconnecting: 'connectionReconnecting',
};

type BoardTopBarProps = {
  boardTitle: string;
  roleCode: BoardRoleCode;
  intensity: FeedbackIntensityCode;
  onIntensityChange: (intensity: FeedbackIntensityCode) => void;
  participants: AvatarParticipant[];
  syncStatus: SyncStatusCode;
  pendingSyncCount: number;
  showQuestButton: boolean;
  onShowQuests: () => void;
  onReloadBoard: () => void;
  userMenu: ReactNode;
};

export default function BoardTopBar({
  boardTitle,
  roleCode,
  intensity,
  onIntensityChange,
  participants,
  syncStatus,
  pendingSyncCount,
  showQuestButton,
  onShowQuests,
  onReloadBoard,
  userMenu,
}: BoardTopBarProps) {
  const t = useTranslations('BoardCanvas');
  const roleLabelKey = resolveRoleLabelKey(roleCode);
  const roster = resolveAvatarRoster(participants);

  return (
    <header className="board-top-bar">
      {/* ロゴはボード一覧への戻る導線を兼ねる（モックに独立した戻るボタンは無い） */}
      <Link aria-label={t('backToBoardList')} className="board-brand" href="/" title={t('backToBoardList')}>
        <span aria-hidden="true" className="board-brand-mark" />
        <span className="board-brand-copy">
          <span className="board-brand-name">{t('brandName')}</span>
          <span className="board-brand-tagline">{t('brandTagline')}</span>
        </span>
      </Link>
      <span aria-hidden="true" className="board-top-bar-divider" />
      <h1 className="board-top-bar-title">{boardTitle}</h1>
      <span className="board-top-bar-spacer" />
      <div className="board-top-bar-group">
        <span className="board-top-bar-caption">{t('roleCaption')}</span>
        <span className="board-role-badge">{roleLabelKey ? t(roleLabelKey) : roleCode}</span>
      </div>
      <div className="board-top-bar-group" role="group" aria-label={t('intensityLabel')}>
        <span className="board-top-bar-caption">{t('intensityLabel')}</span>
        {FEEDBACK_INTENSITY_MASTERS.map((code) => (
          <button
            aria-pressed={intensity === code}
            className="board-seg-button"
            key={code}
            onClick={() => onIntensityChange(code)}
            type="button"
          >
            {t(INTENSITY_LABEL_KEYS[code] as never)}
          </button>
        ))}
      </div>
      <div aria-label={t('participantsLabel')} className="board-avatar-stack" role="group">
        {roster.visible.map((entry) => (
          <span
            className={`board-avatar board-avatar-color-${entry.colorIndex}`}
            key={entry.key}
            title={entry.displayName}
          >
            {entry.initial}
          </span>
        ))}
        {roster.overflowCount > 0 ? (
          <span className="board-avatar board-avatar-overflow">
            {t('participantOverflow', {count: roster.overflowCount})}
          </span>
        ) : null}
      </div>
      <div className={`board-sync-status board-sync-status-${syncStatus}`} role="status">
        <span className="board-sync-status-dot" />
        <span>{t(SYNC_STATUS_LABEL_KEYS[syncStatus] as never)}</span>
        {pendingSyncCount > 0 ? <span>{t('queuedOps', {count: pendingSyncCount})}</span> : null}
      </div>
      {showQuestButton ? (
        <button className="board-top-bar-button" onClick={onShowQuests} type="button">
          <FontAwesomeIcon icon={faListCheck} />
          <span>{t('questsToggle')}</span>
        </button>
      ) : null}
      <button
        aria-label={t('refresh')}
        className="board-top-bar-icon-button"
        onClick={onReloadBoard}
        title={t('refresh')}
        type="button"
      >
        <FontAwesomeIcon icon={faRotate} />
      </button>
      {userMenu}
    </header>
  );
}
