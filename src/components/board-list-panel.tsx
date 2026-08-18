"use client";

import {faSpinner} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import {useTranslations} from 'next-intl';

import {readXAuthSettings} from '@/lib/x-auth';

type SessionState = {
  authenticated: boolean;
};

type BoardListRoleCode = 'owner' | 'editor' | 'commenter' | 'viewer';

type BoardListTranslations = {
  heading: string;
  description: string;
  loadingSession: string;
  loadingBoards: string;
  boardLoadError: string;
  emptyHeading: string;
  emptyDescription: string;
  boardTitleHeader: string;
  roleHeader: string;
  updatedAtHeader: string;
  pageSummary: string;
  previousPage: string;
  nextPage: string;
  ownerRole: string;
  editorRole: string;
  commenterRole: string;
  viewerRole: string;
};

type BoardListItem = {
  id: number;
  roleCode: BoardListRoleCode;
  shareToken: string | null;
  title: string;
  updatedAt: string;
};

type BoardListResponse = {
  boards: BoardListItem[];
  pagination: {
    nextPage: number | null;
    page: number;
    perPage: number;
    previousPage: number | null;
    totalCount: number;
    totalPages: number;
  };
};

function resolveRoleLabelKey(roleCode: BoardListRoleCode): keyof BoardListTranslations {
  switch (roleCode) {
    case 'owner':
      return 'ownerRole';
    case 'editor':
      return 'editorRole';
    case 'commenter':
      return 'commenterRole';
    case 'viewer':
      return 'viewerRole';
  }

  const exhaustiveCheck: never = roleCode;
  return exhaustiveCheck;
}

function formatUpdatedAt(updatedAt: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo'
  }).format(new Date(updatedAt));
}

export default function BoardListPanel() {
  const t = useTranslations('BoardList');
  const [sessionState, setSessionState] = useState<SessionState | null>(() =>
    process.env.NEXT_PUBLIC_ENV === 'development' ? {authenticated: true} : null
  );
  const [loadingSession, setLoadingSession] = useState(process.env.NEXT_PUBLIC_ENV !== 'development');
  const [boardList, setBoardList] = useState<BoardListResponse | null>(null);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [refreshCount, setRefreshCount] = useState(0);

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
          throw new Error(t('boardLoadError'));
        }

        const payload = await response.json() as {authenticated: boolean};
        setSessionState({authenticated: payload.authenticated});
      } catch (error) {
        setSessionState({authenticated: false});
        setErrorMessage(error instanceof Error ? error.message : t('boardLoadError'));
      } finally {
        setLoadingSession(false);
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [t]);

  useEffect(() => {
    if (!sessionState?.authenticated) {
      return;
    }

    // 開発環境でも実際にfetchする。auth-panel.tsx の isDev 分岐が establishDevSession
    // で本物のセッションCookieを張るようになったため、ここをスキップすると
    // 「ボードを作成しても一覧に反映されない」（board-created イベントで
    // refreshCount が変わってもこのeffect自体が動かない）というバグになる。

    const abortController = new AbortController();

    void (async () => {
      try {
        const {backendUrl} = readXAuthSettings();
        const response = await fetch(`${backendUrl}/boards?page=${page}&per_page=10`, {
          credentials: 'include',
          signal: abortController.signal
        });

        if (response.status === 401) {
          setSessionState({authenticated: false});
          return;
        }

        if (!response.ok) {
          throw new Error(t('boardLoadError'));
        }

        setBoardList(await response.json() as BoardListResponse);
        setErrorMessage(null);
      } catch (error) {
        if ((error as {name?: string} | null)?.name === 'AbortError') {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : t('boardLoadError'));
      } finally {
        setLoadingBoards(false);
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [page, sessionState?.authenticated, refreshCount, t]);

  useEffect(() => {
    function handleBoardCreated() {
      setPage(1);
      setRefreshCount((prev) => prev + 1);
    }

    function handlePlanUpdated() {
      setRefreshCount((prev) => prev + 1);
    }

    window.addEventListener('board-created', handleBoardCreated);
    window.addEventListener('user-plan-updated', handlePlanUpdated);
    return () => {
      window.removeEventListener('board-created', handleBoardCreated);
      window.removeEventListener('user-plan-updated', handlePlanUpdated);
    };
  }, []);

  if (loadingSession) {
    return (
      <section className="board-panel" aria-live="polite">
        <p className="auth-status">
          <FontAwesomeIcon icon={faSpinner} spin />
          <span>{t('loadingSession')}</span>
        </p>
      </section>
    );
  }

  if (!sessionState?.authenticated) {
    return null;
  }

  const boards = boardList?.boards ?? [];
  const pagination = boardList?.pagination ?? null;
  const showBoardSpinner = process.env.NEXT_PUBLIC_ENV !== 'development'
    && (loadingBoards || (sessionState?.authenticated && boardList === null && errorMessage === null));

  return (
    <section className="board-panel" aria-busy={loadingBoards}>
      <h2 id="board-list-heading">{t('heading')}</h2>
      <p className="board-copy">{t('description')}</p>
      {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      {showBoardSpinner ? (
        <p className="auth-status">
          <FontAwesomeIcon icon={faSpinner} spin />
          <span>{t('loadingBoards')}</span>
        </p>
      ) : boardList === null && errorMessage !== null ? null : boards.length === 0 ? (
        <div className="board-list-empty">
          <p className="board-copy">{t('emptyHeading')}</p>
          <p className="board-copy">{t('emptyDescription')}</p>
        </div>
      ) : (
        <table className="board-list-table">
          <thead>
            <tr>
              <th>{t('boardTitleHeader')}</th>
              <th>{t('roleHeader')}</th>
              <th>{t('updatedAtHeader')}</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((board) => (
              <tr key={board.id}>
                <th scope="row">
                  {board.shareToken ? (
                    <Link className="board-list-link" href={`/b/${board.shareToken}`}>
                      {board.title}
                    </Link>
                  ) : (
                    <span>
                      {board.title}
                    </span>
                  )}
                </th>
                <td>{t(resolveRoleLabelKey(board.roleCode))}</td>
                <td>{formatUpdatedAt(board.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pagination && pagination.totalPages > 1 ? (
        <div className="board-list-pagination" aria-label={t('pageSummary', {page: String(pagination.page), totalPages: String(pagination.totalPages)})}>
          <p className="board-copy">{t('pageSummary', {page: String(pagination.page), totalPages: String(pagination.totalPages)})}</p>
          <div className="board-list-pagination-controls">
            <button
              className="button button-secondary auth-button"
              disabled={pagination.previousPage === null}
              type="button"
              onClick={() => {
                setLoadingBoards(true);
                setPage(pagination.previousPage ?? 1);
              }}
            >
              {t('previousPage')}
            </button>
            <button
              className="button button-secondary auth-button"
              disabled={pagination.nextPage === null}
              type="button"
              onClick={() => {
                setLoadingBoards(true);
                setPage(pagination.nextPage ?? pagination.page);
              }}
            >
              {t('nextPage')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
