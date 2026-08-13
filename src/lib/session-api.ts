import {readXAuthSettings} from "@/lib/x-auth";

export const NONE_PLAN_CODE = "none";

export type SessionUser = {
  authenticated: boolean;
  displayName?: string;
  planCode?: string;
  xUserId?: string;
};

type SessionPayload = {
  authenticated: boolean;
  user?: {displayName?: string; planCode?: string; xUserId?: string};
};

// セッションが切れた場合と、再判定そのものが失敗した場合を呼び出し側で区別できるようにする。
// 同じ Error にまとめると、ログイン導線へ戻すべき場合とエラー表示に留めるべき場合を
// 取り違える。
export class SessionExpiredError extends Error {}

// 機能を利用できないプラン（フォロワー判定に載っていない状態）かどうか。
// 判定材料はプラン値のみとし、フォロワーキャッシュやX APIを参照しない
// （設計書 F9「機能側の可否判定はプラン値のみを参照する」）。
export function isPlanGated(session: {planCode?: string} | null | undefined): boolean {
  return session?.planCode === NONE_PLAN_CODE;
}

export function toSessionUser(payload: SessionPayload): SessionUser {
  return {
    authenticated: payload.authenticated,
    displayName: payload.user?.displayName,
    planCode: payload.user?.planCode,
    xUserId: payload.user?.xUserId
  };
}

export async function requestManualRecheck(fallbackErrorMessage: string): Promise<SessionUser> {
  const {backendUrl} = readXAuthSettings();
  const response = await fetch(`${backendUrl}/session/recheck`, {
    body: JSON.stringify({manualRecheck: true}),
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });

  if (response.status === 401) {
    throw new SessionExpiredError(fallbackErrorMessage);
  }

  if (!response.ok) {
    // クールダウン中（429）はサーバーが残り時間を含む文言を返すため、それをそのまま見せる。
    const payload = await response.json().catch(() => ({})) as {error?: string};
    throw new Error(payload.error ?? fallbackErrorMessage);
  }

  return toSessionUser(await response.json() as SessionPayload);
}
