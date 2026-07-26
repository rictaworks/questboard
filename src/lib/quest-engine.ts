import type {KpiEventDefinitionCode} from '@/lib/analytics-tracker';

export type QuestStateCode = 'not_started' | 'in_progress' | 'achieved' | 'reward_granted' | 'completed' | 'skipped';

export interface QuestDefinition {
  id: string;
  title: string;
  conditionEvent: KpiEventDefinitionCode;
  conditionCount: number;
}

export interface QuestSnapshot extends QuestDefinition {
  progress: number;
  state: QuestStateCode;
  achievedAt: string | null;
  completedAt: string | null;
  rewardGrantedAt: string | null;
  skippedAt: string | null;
}

// サーバー（src/backend/db/seeds.rb）の quests テーブルと一致していること。
// test/quest-engine.test.mjs が seeds.rb を読んで整合を検証している。
const QUEST_DEFINITION_LIST: readonly QuestDefinition[] = [
  {id: '付箋を3枚作る', title: '付箋を3枚作る', conditionEvent: 'object_created_sticky', conditionCount: 3},
  {id: 'ボードをパンする', title: 'ボードをパンする', conditionEvent: 'camera_panned', conditionCount: 1},
  {id: 'ズームする', title: 'ズームする', conditionEvent: 'camera_zoomed', conditionCount: 1},
  {id: 'ラジアルメニューを開く', title: 'ラジアルメニューを開く', conditionEvent: 'radial_opened', conditionCount: 1},
  {id: 'オブジェクトを削除する', title: 'オブジェクトを削除する', conditionEvent: 'object_deleted', conditionCount: 1},
  {id: 'フレームを作成する', title: 'フレームを作成する', conditionEvent: 'object_created_frame', conditionCount: 1},
  {id: 'ボードを共有する', title: 'ボードを共有する', conditionEvent: 'board_shared', conditionCount: 1},
  {id: 'コメントする', title: 'コメントする', conditionEvent: 'comment_created', conditionCount: 1},
] as const;

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = QUEST_DEFINITION_LIST;

const TERMINAL_STATES: readonly QuestStateCode[] = ['completed', 'skipped'];

/**
 * サーバー応答が届くまでのあいだパネルを描画するための初期値。
 * 祝賀判定にこの配列を使ってはならない（全 not_started のため、
 * 実応答で既存の完了済みクエストを新規完了と誤認する）。
 */
export function createPlaceholderQuestSnapshots(): QuestSnapshot[] {
  return QUEST_DEFINITIONS.map((definition) => ({
    ...definition,
    progress: 0,
    state: 'not_started',
    achievedAt: null,
    completedAt: null,
    rewardGrantedAt: null,
    skippedAt: null,
  }));
}

export function isQuestPanelVisible(quests: readonly QuestSnapshot[]): boolean {
  return quests.some((quest) => !TERMINAL_STATES.includes(quest.state));
}

export function countActiveQuests(quests: readonly QuestSnapshot[]): number {
  return quests.filter((quest) => !TERMINAL_STATES.includes(quest.state)).length;
}

export function isQuestSkippable(state: QuestStateCode): boolean {
  return !TERMINAL_STATES.includes(state);
}

export function questStateLabelKey(state: QuestStateCode): string {
  switch (state) {
    case 'not_started':
      return 'questStateNotStarted';
    case 'in_progress':
      return 'questStateInProgress';
    case 'achieved':
      return 'questStateAchieved';
    case 'reward_granted':
      return 'questStateRewardGranted';
    case 'completed':
      return 'questStateCompleted';
    case 'skipped':
      return 'questStateSkipped';
  }
}
