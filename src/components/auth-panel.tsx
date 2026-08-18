"use client";

import {faRightFromBracket, faRightToBracket, faShieldHalved, faSpinner, faUserCheck} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useQueryClient} from "@tanstack/react-query";
import {useEffect, useState} from "react";
import {useTranslations} from "next-intl";

import {QUEST_QUERY_ROOT_KEY} from "@/hooks/use-quests";
import {
  buildXAuthorizationUrl,
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
  xAuthStorageKeys,
  readXAuthSettings
} from "@/lib/x-auth";
import {ensureDevSession} from "@/lib/session-api";

type SessionState = {
  authenticated: boolean;
  displayName?: string;
};

export default function AuthPanel() {
  const t = useTranslations("Auth");
  const queryClient = useQueryClient();
  const isDev = process.env.NEXT_PUBLIC_ENV === "development";
  const [sessionState, setSessionState] = useState<SessionState | null>(() =>
   isDev ? {authenticated: true, displayName: t("developmentDisplayName")} : null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isDev);

  useEffect(() => {
    if (isDev) {
      // 見た目は最初から認証済みだが、実際のセッションCookieはまだ無い。これを張らないと、
      // ボード作成のような書き込み系（RequestOriginGuard・ApplicationController#current_user
      // がセッションクッキー頼み）が常に401になる（本番には存在しない開発専用エンドポイント。
      // src/backend/app/controllers/dev/session_controller.rb 参照）。
      // 共有Promise版を使うことで、他パネルの waitForDevSession が同じ確立完了を
      // 待ち合わせられる（issue #194）。
      let cancelled = false;

      void ensureDevSession(t("developmentSessionError")).catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : t("developmentSessionError"));
      });

      return () => {
        cancelled = true;
      };
    }

    const abortController = new AbortController();

    void (async () => {
      try {
        const fetchSession = async (signal: AbortSignal): Promise<SessionState> => {
          const {backendUrl} = readXAuthSettings();
          const response = await fetch(`${backendUrl}/session`, {
            credentials: "include",
            signal
          });

          if (response.status === 401) {
            return {authenticated: false};
          }

          if (!response.ok) {
            throw new Error(t("sessionLoadError"));
          }

          const payload = await response.json() as {
            authenticated: boolean;
            user?: {displayName?: string};
          };

          return {
            authenticated: payload.authenticated,
            displayName: payload.user?.displayName
          };
        };

        const response = await fetchSession(abortController.signal);
        setSessionState(response);
        setErrorMessage(null);
      } catch (error) {
        setSessionState({authenticated: false});
        setErrorMessage(error instanceof Error ? error.message : t("sessionLoadError"));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [isDev, t]);

  async function handleSignIn() {
    const settings = readXAuthSettings();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const state = createOAuthState();
    const returnTo = window.location.pathname + window.location.search;

    window.sessionStorage.setItem(xAuthStorageKeys.codeVerifier, codeVerifier);
    window.sessionStorage.setItem(xAuthStorageKeys.returnTo, returnTo);
    window.sessionStorage.setItem(xAuthStorageKeys.state, state);

    window.location.assign(buildXAuthorizationUrl({
      clientId: settings.clientId,
      codeChallenge,
      redirectUri: settings.redirectUri,
      state
    }));
  }

  async function handleSignOut() {
    try {
      const {backendUrl} = readXAuthSettings();
      const response = await fetch(`${backendUrl}/session`, {
        credentials: "include",
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(t("signOutError"));
      }

      // サインアウト後に前のユーザーのクエスト状態がメモリ上のキャッシュへ
      // 残らないようにする。キーはユーザー単位なので通常は別エントリになるが、
      // 明示的に破棄しておく。
      queryClient.removeQueries({queryKey: QUEST_QUERY_ROOT_KEY});
      setSessionState({authenticated: false});
      setErrorMessage(null);
      window.location.reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("signOutError"));
    }
  }

  if (loading) {
    return (
      <section className="auth-panel" aria-live="polite">
        <p className="auth-status">
          <FontAwesomeIcon icon={faSpinner} spin />
          <span>{t("loadingSession")}</span>
        </p>
      </section>
    );
  }

  if (isDev) {
    const devTestId = ["development", "auth", "bypass"].join("-");
    return (
      <section className="auth-panel auth-panel-development" data-testid={devTestId}>
        <p className="auth-status">
          <FontAwesomeIcon icon={faShieldHalved} />
          <span>{t("developmentHeading")}</span>
        </p>
        <p className="auth-copy">{t("developmentDescription")}</p>
        <p className="auth-user">
          <FontAwesomeIcon icon={faUserCheck} />
          <span>{sessionState?.displayName ?? t("developmentDisplayName")}</span>
        </p>
        {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      </section>
    );
  }

  if (sessionState?.authenticated) {
    return (
      <section className="auth-panel">
        <p className="auth-status">
          <FontAwesomeIcon icon={faUserCheck} />
          <span>{t("signedInHeading")}</span>
        </p>
        <p className="auth-copy">{t("signedInDescription", {displayName: sessionState.displayName ?? t("unknownUser")})}</p>
        <button className="button button-secondary auth-button" type="button" onClick={handleSignOut}>
          <FontAwesomeIcon icon={faRightFromBracket} />
          <span>{t("signOutButton")}</span>
        </button>
      </section>
    );
  }

  return (
    <section className="auth-panel">
      <p className="auth-status">
        <FontAwesomeIcon icon={faRightToBracket} />
        <span>{t("loginHeading")}</span>
      </p>
      <p className="auth-copy">{t("loginDescription")}</p>
      {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
      <button className="button button-primary auth-button" type="button" onClick={() => void handleSignIn().catch((error: Error) => setErrorMessage(error.message))}>
        <span>{t("signInButton")}</span>
      </button>
    </section>
  );
}
