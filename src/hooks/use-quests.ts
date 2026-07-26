'use client';

import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {fetchQuests, reopenQuest, skipQuest} from '@/lib/quest-api';
import {QUEST_POLL_INTERVAL_MS} from '@/lib/query-client';
import type {QuestSnapshot} from '@/lib/quest-engine';

// WebSocketハンドラは userGoogleSub を持たないため、前方一致で無効化できるルートキーを公開する。
export const QUEST_QUERY_ROOT_KEY = ['quests'] as const;

/**
 * GET /quests はボード非依存（current_user.user_quests）なので、
 * キャッシュの次元はボードではなくユーザー。アカウント切替時に
 * 前のユーザーのクエストが残らないことも同時に担保される。
 */
export function questQueryKey(userGoogleSub: string) {
  return [...QUEST_QUERY_ROOT_KEY, userGoogleSub] as const;
}

export interface UseQuestsOptions {
  backendUrl: string;
  userGoogleSub: string;
}

export function useQuestsQuery({backendUrl, userGoogleSub}: UseQuestsOptions) {
  return useQuery({
    queryKey: questQueryKey(userGoogleSub),
    // signal の転送は必須。invalidateQueries は cancelRefetch: true が既定だが、
    // signal を渡していないと実際のリクエストが中断されず、古い応答が
    // 新しい応答を追い越す余地が残る。
    queryFn: ({signal}) => fetchQuests({backendUrl}, signal),
    refetchInterval: QUEST_POLL_INTERVAL_MS
  });
}

interface QuestActionOptions extends UseQuestsOptions {
  shareToken: string;
  // 失敗を握り潰さずUIへ伝えるためのフック（フォールバック処理禁止の規約に従う）。
  onError?: (error: Error) => void;
}

function useQuestAction(
  action: (questId: string, options: {backendUrl: string; shareToken: string}) => Promise<void>,
  {backendUrl, shareToken, userGoogleSub, onError}: QuestActionOptions
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (questId: string) => action(questId, {backendUrl, shareToken}),
    onError,
    // onSuccess ではなく onSettled。422（別タブで既にスキップ済み等）でも
    // サーバー真実へ再同期したいため。応答の snapshot はキャッシュに書き戻さない。
    onSettled: () => queryClient.invalidateQueries({queryKey: questQueryKey(userGoogleSub)})
  });
}

export function useSkipQuestMutation(options: QuestActionOptions) {
  return useQuestAction(skipQuest, options);
}

export function useReopenQuestMutation(options: QuestActionOptions) {
  return useQuestAction(reopenQuest, options);
}

export type {QuestSnapshot};
