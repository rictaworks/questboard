"use client";

import {faSpinner, faXmark} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {FormEvent, useCallback, useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';

import AuthPanel from '@/components/auth-panel';
import BoardCanvasPanel, {type BoardCanvasData} from '@/components/board-canvas-panel';
import PlanUnavailablePanel from '@/components/plan-unavailable-panel';
import {resolveRoleLabelKey} from '@/lib/board-role-label';
import {
  ensureDevSession,
  isPlanGated,
  MEMBER_PLAN_CODE,
  requestManualRecheck,
  resolveFollowTargetHandle,
  SessionExpiredError,
  waitForDevSession
} from '@/lib/session-api';
import {readFollowTargetHandle, readXAuthSettings} from '@/lib/x-auth';

type SessionState = {
  authenticated: boolean;
  displayName?: string;
  planCode?: string;
  xUserId?: string;
};

type BoardInviteRoleCode = 'viewer' | 'commenter' | 'editor';

type BoardInviteTranslations = {
  heading: string;
  description: string;
  roleLabel: string;
  viewerRole: string;
  commenterRole: string;
  editorRole: string;
  joinButton: string;
  joiningButton: string;
  notFoundHeading: string;
  notFoundDescription: string;
  ownerRole: string;
  existingMembershipHeading: string;
  existingMembershipDescription: string;
  successHeading: string;
  successDescription: string;
  successDismiss: string;
  errorMessage: string;
};

type BoardMembershipNotice = {
  kind: 'existing' | 'joined';
  title: string;
  roleCode: string;
};

type BoardInviteContentProps = {
  boardNotFound: boolean;
  errorMessage: string | null;
  joining: boolean;
  onJoin: (event: FormEvent<HTMLFormElement>) => void;
  onRoleCodeChange: (roleCode: BoardInviteRoleCode) => void;
  roleCode: BoardInviteRoleCode;
  t: (key: keyof BoardInviteTranslations) => string;
};

export function isBoardNotFoundStatus(status: number) {
  return status === 404;
}

// サーバーが返したロールコードを翻訳キーへ変換する。未知のコードは null を返し、
// 呼び出し側でコードをそのまま表示する。既知のロールへ丸めてしまうと、
// 実際とは違うロール名を見せることになり Issue #89 の目的（ロールの取り違えに
// 気づけるようにする）に反する。
export function BoardJoinSuccessBanner({
  description,
  dismissLabel,
  heading,
  onDismiss
}: {
  description: string;
  dismissLabel: string;
  heading: string;
  onDismiss: () => void;
}) {
  return (
    <div className="board-join-success" role="status">
      <div className="board-join-success-body">
        <strong>{heading}</strong>
        <span>{description}</span>
      </div>
      <button
        aria-label={dismissLabel}
        className="board-join-success-dismiss"
        onClick={onDismiss}
        type="button"
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}

export function BoardErrorBanner({
  message,
  dismissLabel,
  onDismiss
}: {
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="board-join-success"
      role="alert"
      style={{
        border: 'var(--border-width) solid rgba(239, 68, 68, 0.45)',
        background: 'rgba(239, 68, 68, 0.14)'
      }}
    >
      <div className="board-join-success-body">
        <strong>{message}</strong>
      </div>
      <button
        aria-label={dismissLabel}
        className="board-join-success-dismiss"
        onClick={onDismiss}
        type="button"
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>
    </div>
  );
}

export function createExistingMembershipNotice(
  boardData: Pick<BoardCanvasData, 'board' | 'membership'>
): BoardMembershipNotice {
  return {
    kind: 'existing',
    roleCode: boardData.membership.role.code,
    title: boardData.board.title
  };
}

export function createMembershipBannerContent(
  notice: BoardMembershipNotice,
  t: (key: keyof BoardInviteTranslations, values?: {role: string; title: string}) => string
) {
  const roleLabelKey = resolveRoleLabelKey(notice.roleCode);
  const values = {
    role: roleLabelKey ? t(roleLabelKey) : notice.roleCode,
    title: notice.title
  };

  return {
    description: t(
      notice.kind === 'existing' ? 'existingMembershipDescription' : 'successDescription',
      values
    ),
    dismissLabel: t('successDismiss'),
    heading: t(notice.kind === 'existing' ? 'existingMembershipHeading' : 'successHeading')
  };
}

export {resolveRoleLabelKey};

export function BoardInviteContent({
  boardNotFound,
  errorMessage,
  joining,
  onJoin,
  onRoleCodeChange,
  roleCode,
  t
}: BoardInviteContentProps) {
  if (boardNotFound) {
    return (
      <section className="board-panel">
        <h1>{t('notFoundHeading')}</h1>
        <p className="board-copy">{t('notFoundDescription')}</p>
      </section>
    );
  }

  const roleOptions = [
    {code: 'viewer' as const, label: t('viewerRole')},
    {code: 'commenter' as const, label: t('commenterRole')},
    {code: 'editor' as const, label: t('editorRole')}
  ];

  return (
    <section className="board-panel">
      <h1>{t('heading')}</h1>
      <p className="board-copy">{t('description')}</p>
      {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      <form className="board-form" onSubmit={onJoin}>
        <fieldset className="field">
          <legend className="field-label">{t('roleLabel')}</legend>
          <div className="role-options">
            {roleOptions.map((option) => (
              <label className="role-option" key={option.code}>
                <input
                  checked={roleCode === option.code}
                  name="role_code"
                  onChange={() => onRoleCodeChange(option.code)}
                  type="radio"
                  value={option.code}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="button button-primary auth-button" disabled={joining} type="submit">
          <span>{joining ? t('joiningButton') : t('joinButton')}</span>
        </button>
      </form>
    </section>
  );
}

export default function BoardInvitePanel({shareToken}: {shareToken: string}) {
  const t = useTranslations('BoardInvite');
  const authT = useTranslations('Auth');
  const [sessionState, setSessionState] = useState<SessionState | null>(() =>
    process.env.NEXT_PUBLIC_ENV === 'development'
      // 開発環境は最初から認証済みとして見せる。ゲート判定は「member 以外を塞ぐ」ので、
      // プラン値も併せて与えないと開発環境が利用不可画面に落ちる。xUserId は
      // establishDevSession が本物のセッションを確立した時点で実際の値
      // （dev/session_controller.rb の DEV_USER_X_ID）に上書きされる。それまでの
      // 短い間もバックエンドの定数と同じ値にしておき、KPIイベントの
      // userId不一致（422）を起こさない。
      // （コメント中の establishDevSession は共有Promise版 ensureDevSession 経由で呼ばれる）
      ? {
          authenticated: true,
          displayName: authT('developmentDisplayName'),
          planCode: MEMBER_PLAN_CODE,
          xUserId: 'dev-user'
        }
      : null
  );
  const [loading, setLoading] = useState(process.env.NEXT_PUBLIC_ENV !== 'development');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 利用不可画面のフォロー案内で使う。レンダー中に環境変数を読むと未設定時の例外を
  // 捕まえられないため、セッション読み込みの際に解決する。
  const [followTargetHandle, setFollowTargetHandle] = useState<string | null>(null);
  const [roleCode, setRoleCode] = useState<BoardInviteRoleCode>('viewer');
  const [joining, setJoining] = useState(false);
  const [boardData, setBoardData] = useState<BoardCanvasData | null>(null);
  const [boardNotFound, setBoardNotFound] = useState(false);
  // 参加直後に表示する成功メッセージ。ロールはサーバーが確定したものを使う
  // （既存メンバーは再参加してもロールが変わらないため、選択値とは一致しない）。
  const [membershipNotice, setMembershipNotice] = useState<BoardMembershipNotice | null>(null);
  const [rechecking, setRechecking] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENV === 'development') {
      // 見た目は最初から認証済みだが、実際のセッションCookieはまだ無い
      // （auth-panel.tsx と同じ理由）。これを張らないと、KPIイベントの送信
      // （board-canvas-panel.tsx の AnalyticsTracker）が本物のcurrent_userを
      // 得られず、クエスト進捗が記録されない。
      let cancelled = false;

      void ensureDevSession(authT('developmentSessionError'))
        .then((session) => {
          if (cancelled) {
            return;
          }
          setSessionState({
            authenticated: session.authenticated,
            displayName: session.displayName,
            planCode: session.planCode,
            xUserId: session.xUserId
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          setErrorMessage(error instanceof Error ? error.message : authT('developmentSessionError'));
        });

      return () => {
        cancelled = true;
      };
    }

    const abortController = new AbortController();

    void (async () => {
      try {
        const {backendUrl} = readXAuthSettings();
        const response = await fetch(`${backendUrl}/session`, {
          credentials: 'include',
          signal: abortController.signal
        });

        if (response.status === 401) {
          setSessionState({authenticated: false});
          return;
        }

        if (!response.ok) {
          throw new Error(authT('sessionLoadError'));
        }

        const payload = await response.json() as {
          authenticated: boolean;
          user?: {displayName?: string; planCode?: string; xUserId?: string};
        };

        const nextSession = {
          authenticated: payload.authenticated,
          displayName: payload.user?.displayName,
          planCode: payload.user?.planCode,
          xUserId: payload.user?.xUserId
        };

        const followTarget = resolveFollowTargetHandle(
          nextSession,
          readFollowTargetHandle,
          authT('followTargetUnavailable')
        );

        setFollowTargetHandle(followTarget.followTargetHandle);
        setSessionState(nextSession);
        setErrorMessage(followTarget.errorMessage);
      } catch (error) {
        setSessionState({authenticated: false});
        setErrorMessage(error instanceof Error ? error.message : authT('sessionLoadError'));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [authT]);

  const reloadBoard = useCallback(async () => {
    const {backendUrl} = readXAuthSettings();
    const response = await fetch(`${backendUrl}/boards/${encodeURIComponent(shareToken)}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(t('errorMessage'));
    }

    setBoardNotFound(false);
    setBoardData(await response.json() as BoardCanvasData);
  }, [shareToken, t]);

  async function handleManualRecheck() {
    setRechecking(true);

    try {
      const nextSession = await requestManualRecheck(authT('manualRecheckError'));
      setSessionState(nextSession);
      setErrorMessage(null);
      window.dispatchEvent(new CustomEvent('user-plan-updated'));
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        setSessionState({authenticated: false});
        setErrorMessage(authT('sessionExpired'));
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : authT('manualRecheckError'));
    } finally {
      setRechecking(false);
    }
  }

  const authenticated = sessionState?.authenticated ?? false;
  const planGated = isPlanGated(sessionState);

  useEffect(() => {
    // none プランでは機能APIが403を返すため、ボード取得自体を試みない。
    // 試みると意味のないエラーが利用不可画面に重なって出る。
    if (!authenticated || planGated) {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      try {
        // issue #194: 共有リンクをCookie未保持のブラウザで直接開くと、devセッション確立と
        // このボード取得が同時に走り、Cookie確立前の401でボードに到達できなかった。
        // 開発環境では共有devセッションの確立完了を待ってから取得する（本番では何もしない）。
        await waitForDevSession(authT('developmentSessionError'));

        const {backendUrl} = readXAuthSettings();
        const response = await fetch(`${backendUrl}/boards/${encodeURIComponent(shareToken)}`, {
          credentials: 'include',
          signal: abortController.signal
        });

        if (response.status === 401) {
          setSessionState({authenticated: false});
          return;
        }

        if (response.status === 403) {
          setBoardNotFound(false);
          setBoardData(null);
          setMembershipNotice(null);
          setErrorMessage(null);
          return;
        }

        if (isBoardNotFoundStatus(response.status)) {
          setBoardNotFound(true);
          setBoardData(null);
          setMembershipNotice(null);
          setErrorMessage(null);
          return;
        }

        if (!response.ok) {
          throw new Error(t('errorMessage'));
        }

        const nextBoardData = await response.json() as BoardCanvasData;
        setBoardNotFound(false);
        setBoardData(nextBoardData);
        setMembershipNotice(createExistingMembershipNotice(nextBoardData));
        setErrorMessage(null);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setBoardNotFound(false);
          setBoardData(null);
          setMembershipNotice(null);
          setErrorMessage(error instanceof Error ? error.message : t('errorMessage'));
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [authenticated, planGated, shareToken, authT, t]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoining(true);

    try {
      const {backendUrl} = readXAuthSettings();
      const response = await fetch(`${backendUrl}/boards/${encodeURIComponent(shareToken)}/join`, {
        body: JSON.stringify({role_code: roleCode}),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });

      if (response.status === 401) {
        setSessionState({authenticated: false});
        throw new Error(authT('loginHeading'));
      }

      if (isBoardNotFoundStatus(response.status)) {
        setBoardNotFound(true);
        setBoardData(null);
        setErrorMessage(null);
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as {error?: string};
        throw new Error(payload.error ?? t('errorMessage'));
      }

      const payload = await response.json() as {
        board: {title: string; shareToken: string};
        membership: {role: {code: string}};
      };

      setBoardData(null);
      setErrorMessage(null);
      setBoardNotFound(false);
      setMembershipNotice({
        kind: 'joined',
        roleCode: payload.membership.role.code,
        title: payload.board.title
      });
      const boardResponse = await fetch(`${backendUrl}/boards/${encodeURIComponent(payload.board.shareToken)}`, {
        credentials: 'include'
      });

      if (boardResponse.ok) {
        setBoardData(await boardResponse.json() as BoardCanvasData);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('errorMessage'));
    } finally {
      setJoining(false);
    }
  }

  async function handleSignOut() {
    try {
      const {backendUrl} = readXAuthSettings();
      const response = await fetch(`${backendUrl}/session`, {
        credentials: 'include',
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(authT('signOutError'));
      }

      window.location.reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : authT('signOutError'));
    }
  }

  if (loading) {
    return (
      <section className="board-panel" aria-live="polite">
        <p className="auth-status">
          <FontAwesomeIcon icon={faSpinner} spin />
          <span>{authT('loadingSession')}</span>
        </p>
      </section>
    );
  }

  if (!sessionState?.authenticated) {
    return (
      <section className="board-panel">
        <h1>{t('heading')}</h1>
        <p className="board-copy">{t('description')}</p>
        {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
        <AuthPanel />
      </section>
    );
  }

  // 共有URLから入った none プランの利用者にも、403を返すだけで終わらせず
  // 理由と再判定導線を出す（Issue #133「利用不可画面＋フォロー案内＋手動再判定」）。
  if (isPlanGated(sessionState)) {
    return (
      <PlanUnavailablePanel
        errorMessage={errorMessage}
        followTargetHandle={followTargetHandle}
        headingId="board-invite-heading"
        headingLevel="h1"
        onManualRecheck={handleManualRecheck}
        rechecking={rechecking}
      />
    );
  }

  if (boardData) {
    const bannerContent = membershipNotice ? createMembershipBannerContent(membershipNotice, t) : null;
    const hasNotifications = !!bannerContent || !!errorMessage;

    return (
      <>
        {hasNotifications ? (
          <div className="board-notifications" style={{ display: 'grid', gap: 'var(--space-2)' }}>
            {bannerContent ? (
              <BoardJoinSuccessBanner
                description={bannerContent.description}
                dismissLabel={bannerContent.dismissLabel}
                heading={bannerContent.heading}
                onDismiss={() => setMembershipNotice(null)}
              />
            ) : null}
            {errorMessage ? (
              <BoardErrorBanner
                message={errorMessage}
                dismissLabel={t('successDismiss')}
                onDismiss={() => setErrorMessage(null)}
              />
            ) : null}
          </div>
        ) : null}
        <BoardCanvasPanel
          boardData={boardData}
          currentUserDisplayName={sessionState.displayName ?? authT('unknownUser')}
          key={boardData.board.shareToken}
          onReloadBoard={reloadBoard}
          onSignOut={() => void handleSignOut()}
          userXUserId={sessionState.xUserId ?? 'dev-user'}
        />
      </>
    );
  }

  return (
    <BoardInviteContent
      boardNotFound={boardNotFound}
      errorMessage={errorMessage}
      joining={joining}
      onJoin={(event) => void handleJoin(event)}
      onRoleCodeChange={setRoleCode}
      roleCode={roleCode}
      t={t}
    />
  );
}
