'use client';

import {useEffect, useRef, useState} from 'react';

import {FeedbackDirector, type FeedbackDecision} from '@/lib/feedback-director';
import {
  QUEST_CELEBRATION_OVERLAY_MS,
  collectCompletedQuestIds,
  detectNewlyCompletedQuests
} from '@/lib/quest-celebration';
import type {QuestSnapshot} from '@/lib/quest-engine';

/**
 * quests には useQuery の data をそのまま渡すこと（プレースホルダを混ぜてはならない）。
 * プレースホルダ（全 not_started）を基準値にすると、初回の実応答で
 * 「読み込み時点ですでに完了していたクエスト」を新規完了と誤認して祝ってしまう。
 * これは PR #61 レビューで指摘された不具合そのもの。
 */
export function useQuestCelebrations(quests: QuestSnapshot[] | undefined): FeedbackDecision | null {
  const directorRef = useRef<FeedbackDirector | null>(null);
  if (directorRef.current === null) {
    directorRef.current = new FeedbackDirector();
  }

  // null = 初回シード前。ref はマウント中ずっと保持されるため、React 19 StrictMode の
  // 二重effect実行でも2回目は差分が空になり多重発火しない。真にアンマウント→再マウント
  // した場合は再シードされるが、それは「再表示時点で完了済みのものは祝わない」という
  // 仕様どおりの挙動。
  const seenCompletedRef = useRef<string[] | null>(null);
  const [pendingCelebrations, setPendingCelebrations] = useState<FeedbackDecision[]>([]);

  useEffect(() => {
    if (!quests) {
      return;
    }

    const newlyCompleted = detectNewlyCompletedQuests(seenCompletedRef.current, quests);
    seenCompletedRef.current = collectCompletedQuestIds(quests);

    if (newlyCompleted.length === 0) {
      return;
    }

    const director = directorRef.current;
    if (director === null) {
      throw new Error('FeedbackDirector is not initialised');
    }

    const decisions = newlyCompleted.map(() => director.decide('quest_completed', 'full'));
    setPendingCelebrations((current) => [...current, ...decisions]);
  }, [quests]);

  useEffect(() => {
    if (pendingCelebrations.length === 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setPendingCelebrations((current) => current.slice(1));
    }, QUEST_CELEBRATION_OVERLAY_MS);

    return () => window.clearTimeout(timer);
  }, [pendingCelebrations]);

  return pendingCelebrations[0] ?? null;
}
