"use client";

import {faSpinner} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {FormEvent, useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';

import AuthPanel from '@/components/auth-panel';
import BoardCanvasPanel, {type BoardCanvasData} from '@/components/board-canvas-panel';
import {readGoogleAuthSettings} from '@/lib/google-auth';

type SessionState = {
  authenticated: boolean;
  displayName?: string;
};

export default function BoardInvitePanel({shareToken}: {shareToken: string}) {
  const t = useTranslations('BoardInvite');
  const authT = useTranslations('Auth');
  const [sessionState, setSessionState] = useState<SessionState | null>(() =>
    process.env.NEXT_PUBLIC_ENV === 'development' ? {authenticated: true, displayName: authT('developmentDisplayName')} : null
  );
  const [loading, setLoading] = useState(process.env.NEXT_PUBLIC_ENV !== 'development');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [roleCode, setRoleCode] = useState<'viewer' | 'commenter' | 'editor'>('viewer');
  const [joining, setJoining] = useState(false);
  const [boardData, setBoardData] = useState<BoardCanvasData | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENV === 'development') {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      try {
        const {backendUrl} = readGoogleAuthSettings();
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
          user?: {displayName?: string};
        };

        setSessionState({
          authenticated: payload.authenticated,
          displayName: payload.user?.displayName
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

  useEffect(() => {
    if (!sessionState?.authenticated) {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      try {
        const {backendUrl} = readGoogleAuthSettings();
        const response = await fetch(`${backendUrl}/boards/${encodeURIComponent(shareToken)}`, {
          credentials: 'include',
          signal: abortController.signal
        });

        if (response.status === 401) {
          setSessionState({authenticated: false});
          return;
        }

        if (response.status === 403 || response.status === 404) {
          setBoardData(null);
          return;
        }

        if (!response.ok) {
          throw new Error(t('errorMessage'));
        }

        setBoardData(await response.json() as BoardCanvasData);
        setErrorMessage(null);
      } catch (error) {
        if (!abortController.signal.aborted) {
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
      const {backendUrl} = readGoogleAuthSettings();
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

  function roleOptions(t: (key: 'viewerRole' | 'commenterRole' | 'editorRole') => string) {
    return [
      {code: 'viewer' as const, label: t('viewerRole')},
      {code: 'commenter' as const, label: t('commenterRole')},
      {code: 'editor' as const, label: t('editorRole')}
    ];
  }

  if (boardData) {
    return (
      <BoardCanvasPanel
        boardData={boardData}
        currentUserDisplayName={sessionState.displayName ?? authT('unknownUser')}
        onReloadBoard={async () => {
          const {backendUrl} = readGoogleAuthSettings();
          const response = await fetch(`${backendUrl}/boards/${encodeURIComponent(shareToken)}`, {
            credentials: 'include'
          });

          if (!response.ok) {
            throw new Error(t('errorMessage'));
          }

          setBoardData(await response.json() as BoardCanvasData);
        }}
      />
    );
  }

  return (
    <section className="board-panel">
      <h1>{t('heading')}</h1>
      <p className="board-copy">{t('description')}</p>
      {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      <form className="board-form" onSubmit={(event) => void handleJoin(event)}>
        <fieldset className="field">
          <legend className="field-label">{t('roleLabel')}</legend>
          <div className="role-options">
            {roleOptions(t).map((option) => (
              <label className="role-option" key={option.code}>
                <input
                  checked={roleCode === option.code}
                  name="role_code"
                  onChange={() => setRoleCode(option.code)}
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
