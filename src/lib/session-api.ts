import {readXAuthSettings} from "@/lib/x-auth";

// 機能を利用できる唯一のプラン。サーバー側の
// ApplicationController#require_feature_plan!（`code == "member"` 以外を 403）と対の値。
export const MEMBER_PLAN_CODE = "member";

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
//
// 「none を塞ぐ」ではなく「member 以外を塞ぐ」と書くのは、サーバーの
// require_feature_plan! と同じ向きに揃えるため。逆向きにすると、プランが増えたときに
// UI だけが通し、押した先で 403 が並ぶ。プラン値が取れていない場合も、判定不能のまま
// 機能を露出させないよう塞ぐ側に倒す。
export function isPlanGated(session: {planCode?: string} | null | undefined): boolean {
  return session?.planCode !== MEMBER_PLAN_CODE;
}

export type FollowTargetResolution = {
  errorMessage: string | null;
  followTargetHandle: string | null;
};

// 利用不可画面のフォロー案内で使うハンドルを解決する。
//
// 解決の失敗はセッションの失敗ではない。セッション読み込みと同じ try/catch にまとめると、
// 環境変数の設定漏れが「未ログイン」として扱われ、認証済みの利用者に「ログインし直し」を
// 促してしまう（利用不可画面にも到達しなくなる）。失敗はここで切り分けて文言だけ返す。
//
// 読み取りはゲートに掛かったセッションに限る。無条件に読むと、この環境変数の設定漏れが
// 機能を使える利用者まで巻き込む。
export function resolveFollowTargetHandle(
  session: {planCode?: string} | null | undefined,
  readHandle: () => string,
  errorMessage: string
): FollowTargetResolution {
  if (!isPlanGated(session)) {
    return {errorMessage: null, followTargetHandle: null};
  }

  try {
    return {errorMessage: null, followTargetHandle: readHandle()};
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    return {
      errorMessage,
      followTargetHandle: null
    };
  }
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
  // ボディは送らない。SessionController#recheck は対象を常に current_user に固定しており、
  // リクエストボディを参照しない（SPEC/api/rails-backend.md にもボディ仕様は無い）。
  // Content-Type は RequestOriginGuard#verify_content_type! の検査対象なので残す。
  const response = await fetch(`${backendUrl}/session/recheck`, {
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

// フロントの開発認証バイパス（auth-panel.tsx の isDev 分岐）は、見た目だけ認証済みに
// 見せかけて実際のセッションCookieを張らないと、ボード作成のような書き込み系
// （RequestOriginGuard・ApplicationController#current_user がセッションクッキー頼み）が
// 常に401になる。バックエンドの開発専用エンドポイント（本番には存在しない。
// src/backend/config/routes.rb・app/controllers/dev/session_controller.rb 参照）を
// 実際に叩き、本物のセッションを確立する。
//
// モジュールレベルで Promise を保持し、確立は1回だけ行う。認証が必要なパネル
// （board-list-panel.tsx・board-invite-panel.tsx 等）はどこか1つが先に確立していれば
// その完了を待ち、まだ誰も確立していなければ自分で確立を開始する（べき等なので
// 複数パネルが同時に呼んでも POST /dev/session は1回しか飛ばない）。
//
// かつては「待つだけで自分では開始しない」受動的な awaitDevSession() を別に用意して
// いたが、それは「他のコンポーネントが自分より先にマウントされ、既に確立を開始して
// いるはず」という暗黙のマウント順序に依存する設計だった（board-list-panel.tsx は
// page.tsx で AuthPanel より後に置かれているから成立していただけ）。AuthPanel を
// 伴わない画面での再利用やコンポーネント順の入れ替えで容易に壊れるため廃止した。
// 認証が必要な各パネルは establishDevSession() を直接、自分の呼び出しとして
// 呼ぶこと（PR #195 reviewerレビュー対応）。
let _devSessionPromise: Promise<SessionUser> | null = null;

export async function establishDevSession(fallbackErrorMessage: string): Promise<SessionUser> {
  if (_devSessionPromise !== null) {
    return _devSessionPromise;
  }

  const {backendUrl} = readXAuthSettings();

  const sessionPromise: Promise<SessionUser> = (async () => {
    const response = await fetch(`${backendUrl}/dev/session`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(fallbackErrorMessage);
    }

    return toSessionUser(await response.json() as SessionPayload);
  })();

  _devSessionPromise = sessionPromise;

  try {
    return await sessionPromise;
  } catch (error) {
    // 一時的な失敗（500・通信断など）でreject済みPromiseを恒久的にキャッシュしない。
    // 次回呼び出しで再試行できるよう、まだ自分が張った参照であればキャッシュを戻す
    // （自分の後に別の呼び出しが新しいPromiseを張っていた場合はそちらを壊さない）。
    if (_devSessionPromise === sessionPromise) {
      _devSessionPromise = null;
    }
    throw error;
  }
}

// テスト用: モジュール状態をリセットする
export function _resetDevSessionForTesting(): void {
  _devSessionPromise = null;
}
