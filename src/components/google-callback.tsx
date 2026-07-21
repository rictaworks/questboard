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

type CallbackState = {
  errorMessage: string | null;
  status: "loading" | "success" | "error";
  codeVerifier: string | null;
  returnTo: string;
};

export default function GoogleCallback({
  code,
  state
}: {
  code: string | null;
  state: string | null;
}) {
  const t = useTranslations("Auth");
  const router = useRouter();

  const isMissingParams = !code || !state;

  const [{errorMessage, status}, setCallbackState] = useState<CallbackState>(() => ({
    codeVerifier: null,
    errorMessage: isMissingParams ? t("callbackMissingCode") : null,
    returnTo: "/",
    status: isMissingParams ? "error" : "loading"
  }));

  useEffect(() => {
    if (isMissingParams || status !== "loading") {
      return;
    }

    void (async () => {
      const storedState = window.sessionStorage.getItem(callbackStateKey);
      const codeVerifier = window.sessionStorage.getItem(googleAuthStorageKeys.codeVerifier);
      const rawReturnTo = window.sessionStorage.getItem(googleAuthStorageKeys.returnTo);
      const returnTo = normalizeReturnTo(rawReturnTo);

      if (storedState !== state || !codeVerifier) {
        setCallbackState({
          codeVerifier: null,
          errorMessage: t("callbackStateMismatch"),
          returnTo,
          status: "error"
        });
        return;
      }

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
        setCallbackState({
          codeVerifier: null,
          errorMessage: null,
          returnTo,
          status: "success"
        });
        router.replace(returnTo as never);
      } catch (error) {
        setCallbackState({
          codeVerifier: null,
          errorMessage: error instanceof Error ? error.message : t("callbackFailure"),
          returnTo,
          status: "error"
        });
      }
    })();
  }, [code, isMissingParams, router, state, status, t]);

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
