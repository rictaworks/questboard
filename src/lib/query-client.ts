import {QueryClient} from '@tanstack/react-query';

// WebSocket通知に頼れない場合（Redis未設定・配信失敗・切断中など）のフォールバック間隔。
// SyncOpRelay は SYNC_SERVER_REDIS_URL 未設定時に publish を黙って無視するため、
// 開発環境ではこのポーリングがクエスト状態を更新する唯一の経路になる。
export const QUEST_POLL_INTERVAL_MS = 20_000;

// 連続する invalidate（WS通知の連打など）で同じ取得が重複しないようにする猶予。
export const QUEST_STALE_TIME_MS = 5_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUEST_STALE_TIME_MS,
        retry: 1,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true
      }
    }
  });
}
