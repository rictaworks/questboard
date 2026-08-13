"use client";

import {faSpinner} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {FormEvent, useEffect, useMemo, useState} from 'react';
import {useTranslations} from 'next-intl';

import PlanUnavailablePanel from '@/components/plan-unavailable-panel';
import {isPlanGated, requestManualRecheck, SessionExpiredError} from '@/lib/session-api';
import {readXAuthSettings} from '@/lib/x-auth';

type SessionState = {
  authenticated: boolean;
  displayName?: string;
  planCode?: string;
};

type CreatedBoard = {
  title: string;
  shareUrl: string;
};

export default function BoardCreatePanel() {
  const t = useTranslations('BoardCreate');
  const authT = useTranslations('Auth');
  const [sessionState, setSessionState] = useState<SessionState | null>(() =>
    process.env.NEXT_PUBLIC_ENV === 'development'
      ? {authenticated: true, displayName: authT('developmentDisplayName')}
      : null
  );
  const [loading, setLoading] = useState(process.env.NEXT_PUBLIC_ENV !== 'development');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [createdBoard, setCreatedBoard] = useState<CreatedBoard | null>(null);
  const [creating, setCreating] = useState(false);
  const [rechecking, setRechecking] = useState(false);

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
          user?: {displayName?: string; planCode?: string};
        };

        setSessionState({
          authenticated: payload.authenticated,
          displayName: payload.user?.displayName,
          planCode: payload.user?.planCode
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

  const shareUrl = useMemo(() => createdBoard?.shareUrl ?? null, [createdBoard]);

  async function handleManualRecheck() {
    setRechecking(true);

    try {
      setSessionState(await requestManualRecheck(authT('manualRecheckError')));
      setErrorMessage(null);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);

    try {
      const {backendUrl} = readXAuthSettings();
      const response = await fetch(`${backendUrl}/boards`, {
        body: JSON.stringify({title}),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        method: 'POST'
      });

      if (response.status === 401) {
        setSessionState({authenticated: false});
        throw new Error(t('signInHint'));
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as {error?: string};
        throw new Error(payload.error ?? t('createError'));
      }

      const payload = await response.json() as {
        board: {title: string; shareToken: string};
      };

      setCreatedBoard({
        title: payload.board.title,
        shareUrl: new URL(`/b/${payload.board.shareToken}`, window.location.origin).toString()
      });
      setTitle('');
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('createError'));
    } finally {
      setCreating(false);
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
      <section className="board-panel" aria-live="polite">
        <h2 id="board-create-heading">{t('heading')}</h2>
        <p className="board-copy">{t('description')}</p>
        <p className="board-copy">{t('signInHint')}</p>
        <a className="button button-secondary auth-button" href="#auth-heading">
          {authT('loginHeading')}
        </a>
        {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      </section>
    );
  }

  if (isPlanGated(sessionState)) {
    return (
      <PlanUnavailablePanel
        errorMessage={errorMessage}
        headingId="board-create-heading"
        headingLevel="h2"
        onManualRecheck={handleManualRecheck}
        rechecking={rechecking}
      />
    );
  }

  return (
    <section className="board-panel">
      <h2 id="board-create-heading">{t('heading')}</h2>
      <p className="board-copy">{t('description')}</p>
      {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      {createdBoard ? (
        <div className="board-success">
          <p className="auth-status">{t('successHeading')}</p>
          <p className="board-copy">{t('successDescription', {title: createdBoard.title})}</p>
          <p className="board-share-url">
            <span>{t('shareUrlLabel')}</span>
            <a href={shareUrl ?? '#'}>{shareUrl}</a>
          </p>
        </div>
      ) : null}
      <form className="board-form" onSubmit={(event) => void handleSubmit(event)}>
        <label className="field">
          <span className="field-label">{t('titleLabel')}</span>
          <input
            className="field-input"
            maxLength={120}
            name="title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('titlePlaceholder')}
            required
            value={title}
          />
        </label>
        <button className="button button-primary auth-button" disabled={creating} type="submit">
          <span>{creating ? t('creatingButton') : t('submitButton')}</span>
        </button>
      </form>
    </section>
  );
}
