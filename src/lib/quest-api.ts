import type {QuestSnapshot} from '@/lib/quest-engine';

export interface QuestApiOptions {
  backendUrl: string;
  // AnalyticsTracker と同じくテストから差し替えられるようにする。
  fetchImpl?: typeof fetch;
}

export interface QuestMutationOptions extends QuestApiOptions {
  shareToken: string;
}

export class QuestApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'QuestApiError';
    this.status = status;
  }
}

function resolveFetch(options: QuestApiOptions): typeof fetch {
  return options.fetchImpl ?? fetch;
}

async function readJson(response: Response, url: string): Promise<unknown> {
  if (!response.ok) {
    throw new QuestApiError(`Quest API request failed: ${url}`, response.status);
  }

  return response.json();
}

/**
 * クエスト状態の唯一の権威。WebSocket通知は「変わった」という合図しか運ばないため、
 * 実データは必ずこの認証済みエンドポイントから取得する。
 *
 * signal は必ず呼び出し元（useQuery の queryFn）から転送すること。転送しないと
 * invalidateQueries の cancelRefetch が実際のリクエストを中断できず、
 * 古い応答が新しい応答を追い越す余地が残る。
 */
export async function fetchQuests(
  options: QuestApiOptions,
  signal?: AbortSignal
): Promise<QuestSnapshot[]> {
  const url = `${options.backendUrl}/quests`;
  const response = await resolveFetch(options)(url, {credentials: 'include', signal});
  const payload = await readJson(response, url);

  if (!Array.isArray(payload)) {
    throw new QuestApiError(`Quest API returned a non-array body: ${url}`, response.status);
  }

  return payload as QuestSnapshot[];
}

async function postQuestAction(
  action: 'skip' | 'reopen',
  questId: string,
  options: QuestMutationOptions
): Promise<void> {
  const url = `${options.backendUrl}/quests/${encodeURIComponent(questId)}/${action}`;
  const response = await resolveFetch(options)(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({share_token: options.shareToken}),
    credentials: 'include'
  });

  // 応答の snapshot は意図的に捨てる。キャッシュへ書き戻すと GET とミューテーションという
  // 2 つの書き手ができ、「reopen 応答の後に古い GET が届いて巻き戻る」順序逆転が復活する
  // （PR #61 レビュー）。権威データは常に GET /quests から取り直す。
  await readJson(response, url);
}

export function skipQuest(questId: string, options: QuestMutationOptions): Promise<void> {
  return postQuestAction('skip', questId, options);
}

export function reopenQuest(questId: string, options: QuestMutationOptions): Promise<void> {
  return postQuestAction('reopen', questId, options);
}
