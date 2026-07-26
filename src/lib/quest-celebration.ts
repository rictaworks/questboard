import type {QuestSnapshot} from '@/lib/quest-engine';

// クエスト完了オーバーレイの表示時間。CSS側の fadeInOut / fadeInOutSimple キーフレーム
// (2000ms) と揃えること。FeedbackDecision.durationMs はキャンバス上の小さな演出
// （radial_bloom 等、180ms前後）向けの値であり、全画面オーバーレイをその短い時間で
// 閉じると内容を読み切る前に消えてしまう（PR #61 レビュー参照）。
export const QUEST_CELEBRATION_OVERLAY_MS = 2000;

export function collectCompletedQuestIds(quests: readonly QuestSnapshot[]): string[] {
  return quests.filter((quest) => quest.state === 'completed').map((quest) => quest.id);
}

/**
 * 直前に観測した「完了済みID一覧」と最新のクエスト一覧を比較し、
 * 今回はじめて completed になったクエストIDだけを返す純関数。
 *
 * previousCompletedIds === null は「まだ一度もサーバー応答を観測していない」を意味し、
 * 必ず空配列を返す。ページ表示時点ですでに完了済みだったクエストを祝わないため
 * （PR #61 レビュー参照）。
 */
export function detectNewlyCompletedQuests(
  previousCompletedIds: readonly string[] | null,
  nextQuests: readonly QuestSnapshot[]
): string[] {
  if (previousCompletedIds === null) {
    return [];
  }

  const seen = new Set(previousCompletedIds);
  return collectCompletedQuestIds(nextQuests).filter((id) => !seen.has(id));
}
