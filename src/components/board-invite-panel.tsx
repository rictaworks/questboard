"use client";

import {faSpinner, faXmark} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {FormEvent, useCallback, useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';

import AuthPanel from '@/components/auth-panel';
import BoardCanvasPanel, {type BoardCanvasData} from '@/components/board-canvas-panel';
import {readXAuthSettings} from '@/lib/x-auth';

type SessionState = {
  authenticated: boolean;
  displayName?: string;
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
  successHeading: string;
  successDescription: string;
  successDismiss: string;
  errorMessage: string;
};

type BoardJoinSuccess = {
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
export function resolveRoleLabelKey(roleCode: string): keyof BoardInviteTranslations | null {
  switch (roleCode) {
    case 'owner':
      return 'ownerRole';
    case 'editor':
      return 'editorRole';
    case 'commenter':
      return 'commenterRole';
    case 'viewer':
      return 'viewerRole';
    default:
      return null;
  }
}

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
      ? {authenticated: true, displayName: authT('developmentDisplayName'), xUserId: 'development-x-user-id'}
      : null
  );
  const [loading, setLoading] = useState(process.env.NEXT_PUBLIC_ENV !== 'development');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roleCode, setRoleCode] = useState<BoardInviteRoleCode>('viewer');
  const [joining, setJoining] = useState(false);
  const [boardData, setBoardData] = useState<BoardCanvasData | null>(null);
  const [boardNotFound, setBoardNotFound] = useState(false);
  // 参加直後に表示する成功メッセージ。ロールはサーバーが確定したものを使う
  // （既存メンバーは再参加してもロールが変わらないため、選択値とは一致しない）。
  const [joinSuccess, setJoinSuccess] = useState<BoardJoinSuccess | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENV === 'development') {
      return;
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
          user?: {displayName?: string; xUserId?: string};
        };

        setSessionState({
          authenticated: payload.authenticated,
          displayName: payload.user?.displayName,
          xUserId: payload.user?.xUserId
        });
        setErrorMessage(null);
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

  useEffect(() => {
    if (!sessionState?.authenticated) {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      try {
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
          setErrorMessage(null);
          return;
        }

        if (isBoardNotFoundStatus(response.status)) {
          setBoardNotFound(true);
          setBoardData(null);
          setErrorMessage(null);
          return;
        }

        if (!response.ok) {
          throw new Error(t('errorMessage'));
        }

        setBoardNotFound(false);
        setBoardData(await response.json() as BoardCanvasData);
        setErrorMessage(null);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setBoardNotFound(false);
          setBoardData(null);
          setErrorMessage(error instanceof Error ? error.message : t('errorMessage'));
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [sessionState?.authenticated, shareToken, t]);

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
      setJoinSuccess({title: payload.board.title, roleCode: payload.membership.role.code});
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

  if (boardData) {
    const roleLabelKey = joinSuccess ? resolveRoleLabelKey(joinSuccess.roleCode) : null;

    return (
      <>
        {joinSuccess ? (
          <BoardJoinSuccessBanner
            description={t('successDescription', {
              role: roleLabelKey ? t(roleLabelKey) : joinSuccess.roleCode,
              title: joinSuccess.title
            })}
            dismissLabel={t('successDismiss')}
            heading={t('successHeading')}
            onDismiss={() => setJoinSuccess(null)}
          />
        ) : null}
        <BoardCanvasPanel
          boardData={boardData}
          key={boardData.board.shareToken}
          onReloadBoard={reloadBoard}
          userXUserId={sessionState.xUserId ?? 'development-x-user-id'}
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
