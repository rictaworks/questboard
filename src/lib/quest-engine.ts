import {FeedbackDirector, type FeedbackDecision, type FeedbackIntensityCode} from '@/lib/feedback-director';
import type {AnalyticsTrackerEvent, KpiEventDefinitionCode} from '@/lib/analytics-tracker';

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

export interface QuestEngineSnapshot {
  panelVisible: boolean;
  lastCelebration: FeedbackDecision | null;
  quests: QuestSnapshot[];
}

export interface QuestTrackResult {
  startedQuestIds: string[];
  achievedQuestIds: string[];
  rewardDecisions: Array<{questId: string; decision: FeedbackDecision}>;
}

export interface QuestEngineOptions {
  feedbackDirector?: FeedbackDirector;
}

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

export class QuestEngine {
  private readonly feedbackDirector: FeedbackDirector;
  private readonly definitions: readonly QuestDefinition[];
  private readonly listeners = new Set<() => void>();
  private readonly questState = new Map<string, QuestSnapshot>();
  private lastCelebration: FeedbackDecision | null = null;

  constructor(definitions: readonly QuestDefinition[] = QUEST_DEFINITIONS, options: QuestEngineOptions = {}) {
    this.definitions = definitions;
    this.feedbackDirector = options.feedbackDirector ?? new FeedbackDirector();
    this.reset();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    this.questState.clear();
    for (const definition of this.definitions) {
      this.questState.set(definition.id, this.createSnapshot(definition));
    }
    this.lastCelebration = null;
    this.emit();
  }

  getSnapshot(): QuestEngineSnapshot {
    const quests = this.definitions.map((definition) => {
      const snapshot = this.questState.get(definition.id);
      if (!snapshot) {
        return this.createSnapshot(definition);
      }

      return {...snapshot};
    });

    return {
      panelVisible: quests.some((quest) => quest.state !== 'completed' && quest.state !== 'skipped'),
      lastCelebration: this.lastCelebration ? {...this.lastCelebration} : null,
      quests,
    };
  }

  trackEvent(event: AnalyticsTrackerEvent, options: {autoAdvanceReward?: boolean; intensity?: FeedbackIntensityCode} = {}): QuestTrackResult {
    const startedQuestIds: string[] = [];
    const achievedQuestIds: string[] = [];
    const rewardDecisions: Array<{questId: string; decision: FeedbackDecision}> = [];

    for (const definition of this.definitions) {
      if (definition.conditionEvent !== event.eventId) {
        continue;
      }

      const snapshot = this.questState.get(definition.id);
      if (!snapshot || snapshot.state === 'completed' || snapshot.state === 'skipped' || snapshot.state === 'reward_granted') {
        continue;
      }

      const nextState: QuestSnapshot = {...snapshot};
      if (nextState.state === 'not_started') {
        nextState.state = 'in_progress';
        startedQuestIds.push(nextState.id);
      }

      nextState.progress = Math.min(nextState.progress + 1, definition.conditionCount);
      if (nextState.progress >= definition.conditionCount) {
        nextState.state = 'achieved';
        nextState.achievedAt = nextState.achievedAt ?? new Date().toISOString();
        achievedQuestIds.push(nextState.id);
      }

      this.questState.set(definition.id, nextState);
    }

    if (options.autoAdvanceReward) {
      for (const questId of achievedQuestIds) {
        const decision = this.grantReward(questId, options.intensity);
        if (decision) {
          rewardDecisions.push({questId, decision});
          this.completeQuest(questId);
        }
      }
    }

    if (startedQuestIds.length > 0 || achievedQuestIds.length > 0 || rewardDecisions.length > 0) {
      this.emit();
    }

    return {startedQuestIds, achievedQuestIds, rewardDecisions};
  }

  skipQuest(questId: string): boolean {
    const snapshot = this.questState.get(questId);
    if (!snapshot || snapshot.state === 'completed' || snapshot.state === 'skipped') {
      return false;
    }

    this.questState.set(questId, {
      ...snapshot,
      state: 'skipped',
      skippedAt: snapshot.skippedAt ?? new Date().toISOString(),
    });
    this.emit();
    return true;
  }

  reopenQuest(questId: string): boolean {
    const snapshot = this.questState.get(questId);
    if (!snapshot || snapshot.state !== 'skipped') {
      return false;
    }

    this.questState.set(questId, {
      ...snapshot,
      state: 'in_progress',
      skippedAt: snapshot.skippedAt,
    });
    this.emit();
    return true;
  }

  grantReward(questId: string, intensity: FeedbackIntensityCode = 'full'): FeedbackDecision | null {
    const snapshot = this.questState.get(questId);
    if (!snapshot || snapshot.state !== 'achieved') {
      return null;
    }

    const decision = this.feedbackDirector.decide('quest_completed', intensity);
    this.lastCelebration = decision;
    this.questState.set(questId, {
      ...snapshot,
      state: 'reward_granted',
      rewardGrantedAt: snapshot.rewardGrantedAt ?? new Date().toISOString(),
    });
    this.emit();
    return decision;
  }

  completeQuest(questId: string): boolean {
    const snapshot = this.questState.get(questId);
    if (!snapshot || snapshot.state !== 'reward_granted') {
      return false;
    }

    this.questState.set(questId, {
      ...snapshot,
      state: 'completed',
      completedAt: snapshot.completedAt ?? new Date().toISOString(),
    });
    this.emit();
    return true;
  }

  isPanelVisible(): boolean {
    return this.getSnapshot().panelVisible;
  }

  private createSnapshot(definition: QuestDefinition): QuestSnapshot {
    return {
      ...definition,
      progress: 0,
      state: 'not_started',
      achievedAt: null,
      completedAt: null,
      rewardGrantedAt: null,
      skippedAt: null,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const questEngine = new QuestEngine();
