"use client";

import {faChevronLeft, faCircle, faCircleCheck, faForward, faStar, type IconDefinition} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {useTranslations} from 'next-intl';

import {isQuestSkippable, questStateLabelKey, type QuestSnapshot, type QuestStateCode} from '@/lib/quest-engine';

// モック（app-ui/Questboard Prototype.dc.html）の常時表示クエストサイドバー。
// 各行＝状態アイコン＋タイトル＋進捗バー＋スキップ/再開、下部に操作ヒント凡例。
// 表示条件（全完了/全スキップで非表示）は親の isQuestPanelVisible が決める。

const QUEST_STATE_ICONS: Record<QuestStateCode, IconDefinition> = {
  achieved: faStar,
  completed: faCircleCheck,
  in_progress: faCircle,
  not_started: faCircle,
  reward_granted: faStar,
  skipped: faForward,
};

type BoardQuestSidebarProps = {
  quests: QuestSnapshot[];
  hasSyncError: boolean;
  skipPending: boolean;
  reopenPending: boolean;
  onSkip: (questId: string) => void;
  onReopen: (questId: string) => void;
  onSkipAll: () => void;
  onCollapse: () => void;
};

export default function BoardQuestSidebar({
  quests,
  hasSyncError,
  skipPending,
  reopenPending,
  onSkip,
  onReopen,
  onSkipAll,
  onCollapse,
}: BoardQuestSidebarProps) {
  const t = useTranslations('BoardCanvas');
  const hasSkippableQuest = quests.some((quest) => isQuestSkippable(quest.state));

  return (
    <aside aria-label={t('questHeading')} className="board-quest-sidebar" tabIndex={0}>
      <div className="board-quest-sidebar-heading">
        <div>
          <p className="board-quest-eyebrow">{t('questEyebrow')}</p>
          <h2>{t('questHeading')}</h2>
        </div>
        <button
          aria-label={t('questsCollapse')}
          className="board-quest-collapse"
          onClick={onCollapse}
          title={t('questsCollapse')}
          type="button"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      </div>
      {hasSyncError ? (
        <p className="board-quest-error" role="alert">{t('questSyncError')}</p>
      ) : null}
      <ul className="board-quest-list">
        {quests.map((quest) => {
          const progressPercent = Math.min(100, Math.round((quest.progress / quest.conditionCount) * 100));

          return (
            <li className={`board-quest-item board-quest-item-${quest.state}`} key={quest.id}>
              <div className="board-quest-item-title-row">
                <FontAwesomeIcon className="board-quest-item-icon" icon={QUEST_STATE_ICONS[quest.state] ?? faCircle} />
                <span className="board-quest-item-title">{quest.title}</span>
                <span className="board-quest-item-state">{t(questStateLabelKey(quest.state) as never)}</span>
              </div>
              <div className="board-quest-progress-track">
                <div className="board-quest-progress-fill" style={{width: `${progressPercent}%`}} />
              </div>
              <p className="board-quest-progress">
                {t('questProgress', {current: quest.progress, total: quest.conditionCount})}
              </p>
              <div className="board-quest-actions">
                {isQuestSkippable(quest.state) ? (
                  <button
                    className="board-quest-action-button"
                    disabled={skipPending}
                    onClick={() => onSkip(quest.id)}
                    type="button"
                  >
                    {t('questSkip')}
                  </button>
                ) : null}
                {quest.state === 'skipped' ? (
                  <button
                    className="board-quest-action-button"
                    disabled={reopenPending}
                    onClick={() => onReopen(quest.id)}
                    type="button"
                  >
                    {t('questReopen')}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hasSkippableQuest ? (
        <button className="board-quest-skip-all" disabled={skipPending} onClick={onSkipAll} type="button">
          {t('questSkipAll')}
        </button>
      ) : null}
      <div className="board-quest-hints">
        <p>{t('hintCreate')}</p>
        <p>{t('hintRadial')}</p>
        <p>{t('hintPan')}</p>
        <p>{t('hintZoom')}</p>
      </div>
    </aside>
  );
}
