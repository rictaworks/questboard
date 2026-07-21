"use client";

import {faCircleExclamation, faCircleNotch, faUserCheck} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";

import {
  googleAuthStorageKeys,
  loadRecaptchaToken,
  readGoogleAuthSettings
} from "@/lib/google-auth";

const callbackStateKey = googleAuthStorageKeys.state;

export default function GoogleCallback({
  code,
  state
}: {
  code: string | null;
  state: string | null;
}) {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    if (!code || !state) {
      setStatus("error");
      setErrorMessage(t("callbackMissingCode"));
      return;
    }

    const storedState = window.sessionStorage.getItem(callbackStateKey);
    const codeVerifier = window.sessionStorage.getItem(googleAuthStorageKeys.codeVerifier);
    const returnTo = normalizeReturnTo(window.sessionStorage.getItem(googleAuthStorageKeys.returnTo));

    if (storedState !== state || !codeVerifier) {
      setStatus("error");
      setErrorMessage(t("callbackStateMismatch"));
      return;
    }

    void (async () => {
      try {
        const settings = readGoogleAuthSettings();
        const recaptchaToken = await loadRecaptchaToken(settings.recaptchaSiteKey, "login");
        const response = await fetch(`${settings.backendUrl}/auth/google_sessions`, {
          body: JSON.stringify({
            code,
            code_verifier: codeVerifier,
            recaptcha_token: recaptchaToken
          }),
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          method: "POST"
        });

        if (!response.ok) {
          const payload = await response.json() as {error?: string};
          throw new Error(payload.error ?? t("callbackFailure"));
        }

        window.sessionStorage.removeItem(googleAuthStorageKeys.codeVerifier);
        window.sessionStorage.removeItem(googleAuthStorageKeys.state);
        window.sessionStorage.removeItem(googleAuthStorageKeys.returnTo);
        setStatus("success");
        router.replace(returnTo as never);
      } catch (error) {
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : t("callbackFailure"));
      }
    })();
  }, [code, router, state, t]);

  return (
    <main className="home-shell">
      <section className="hero-card auth-callback-card">
        <p className="auth-status">
          <FontAwesomeIcon icon={status === "error" ? faCircleExclamation : faCircleNotch} spin={status === "loading"} />
          <span>{status === "loading" ? t("callbackHeading") : t("callbackSuccess")}</span>
        </p>
        <p className="hero-copy">{status === "loading" ? t("callbackDescription") : t("callbackRedirecting")}</p>
        {errorMessage ? <p className="auth-error" role="alert">{errorMessage}</p> : null}
        {status === "error" ? (
          <p className="auth-copy">
            <FontAwesomeIcon icon={faUserCheck} />
            <span>{t("callbackRecovery")}</span>
          </p>
        ) : null}
      </section>
    </main>
  );
}

function normalizeReturnTo(returnTo: string | null): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/";
  }

  return returnTo;
}
