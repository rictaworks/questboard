"use client";

import {faRightFromBracket, faRightToBracket, faShieldHalved, faSpinner, faUserCheck} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useEffect, useState} from "react";
import {useTranslations} from "next-intl";

import {
  buildGoogleAuthorizationUrl,
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
  googleAuthStorageKeys,
  readGoogleAuthSettings
} from "@/lib/google-auth";

type SessionState = {
  authenticated: boolean;
  displayName?: string;
};

export default function AuthPanel() {
  const t = useTranslations("Auth");
  const isDev = process.env.NEXT_PUBLIC_ENV === "development";
  const [sessionState, setSessionState] = useState<SessionState | null>(() =>
    process.env.NEXT_PUBLIC_ENV === "development" ? {authenticated: true, displayName: t("developmentDisplayName")} : null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(process.env.NEXT_PUBLIC_ENV !== "development");

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENV === "development") {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      try {
        const fetchSession = async (signal: AbortSignal): Promise<SessionState> => {
          const {backendUrl} = readGoogleAuthSettings();
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
  }, [t]);

  async function handleSignIn() {
    const settings = readGoogleAuthSettings();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const state = createOAuthState();
    const returnTo = window.location.pathname + window.location.search;

    window.sessionStorage.setItem(googleAuthStorageKeys.codeVerifier, codeVerifier);
    window.sessionStorage.setItem(googleAuthStorageKeys.returnTo, returnTo);
    window.sessionStorage.setItem(googleAuthStorageKeys.state, state);

    window.location.assign(buildGoogleAuthorizationUrl({
      clientId: settings.clientId,
      codeChallenge,
      redirectUri: settings.redirectUri,
      state
    }));
  }

  async function handleSignOut() {
    try {
      const {backendUrl} = readGoogleAuthSettings();
      const response = await fetch(`${backendUrl}/session`, {
        credentials: "include",
        method: "DELETE"
      });

      if (!response.ok) {
        throw new Error(t("signOutError"));
      }

      setSessionState({authenticated: false});
      setErrorMessage(null);
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

  if (process.env.NEXT_PUBLIC_ENV === "development") {
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
