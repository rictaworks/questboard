"use client";

import {faCircleExclamation, faCircleNotch, faUserCheck} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";

import {reportClientError} from "@/lib/client-error-report";
import {
  googleAuthStorageKeys,
  loadRecaptchaToken,
  readGoogleAuthSettings
} from "@/lib/google-auth";

const callbackStateKey = googleAuthStorageKeys.state;

type CallbackStatus = "loading" | "success" | "error";

type CallbackState = {
  errorMessage: string | null;
  status: CallbackStatus;
  codeVerifier: string | null;
  returnTo: string;
};

const callbackHeadingKeys: Record<CallbackStatus, string> = {
  loading: "callbackHeading",
  success: "callbackSuccess",
  error: "callbackErrorHeading"
};

// error のときは errorMessage と callbackRecovery が続くため、本文は出さない。
const callbackDescriptionKeys: Record<CallbackStatus, string | null> = {
  loading: "callbackDescription",
  success: "callbackRedirecting",
  error: null
};

// Google が返す error の値は access_denied（利用者がキャンセル）のほか、
// invalid_request や admin_policy_enforced など設定・ポリシー由来のものがある。
// 利用者に伝えられるのは「キャンセルされた」か「Google 側で中断された」かの区別まで。
//
// 生の値は画面に出さない。この経路は誰でも叩ける公開 GET で error は任意の文字列を
// 取れるため、そのまま描画すると攻撃者が書いた文章を製品自身のエラーメッセージとして
// 表示できてしまう。切り分けに要る生の値は reportClientError でバックエンドのログへ送る。
// 通報に載せる長さの上限。state を確かめてから送るとはいえ、値そのものは
// クエリ由来で長さを選べるため、ログを1件で埋められないようにしておく。
const REPORTED_VALUE_MAX_LENGTH = 200;

function truncate(value: string | null): string {
  if (value === null) {
    return "";
  }

  return value.length <= REPORTED_VALUE_MAX_LENGTH
    ? value
    : `${value.slice(0, REPORTED_VALUE_MAX_LENGTH)}…`;
}

function readProviderErrorKey(error: string | null): "callbackDenied" | "callbackProviderError" | null {
  if (error === null || error.trim() === "") {
    return null;
  }

  return error.trim() === "access_denied" ? "callbackDenied" : "callbackProviderError";
}

export default function GoogleCallback({
  code,
  error,
  errorDescription,
  state
}: {
  code: string | null;
  error: string | null;
  errorDescription: string | null;
  state: string | null;
}) {
  const t = useTranslations("Auth");
  const router = useRouter();

  // Google がエラーを返した場合は、code の有無に関わらずそれを理由として表示する。
  // 見ずに code 欠落として扱うと、同意画面でキャンセルしただけの利用者に
  // 「認可コードが見つかりません」という無関係な原因が示される。
  const providerErrorKey = readProviderErrorKey(error);
  const isMissingParams = !code || !state;
  const initialErrorMessage = providerErrorKey === null
    ? (isMissingParams ? t("callbackMissingCode") : null)
    : t(providerErrorKey);

  // 失敗理由は props から毎回導出する。useState の遅延初期化に閉じ込めると、
  // クライアント遷移で同じインスタンスが使い回されたときに初期化関数が再実行されず、
  // 画面が「Google ログインを完了しています」のまま止まる。
  const [asyncState, setCallbackState] = useState<CallbackState>({
    codeVerifier: null,
    errorMessage: null,
    returnTo: "/",
    status: "loading"
  });

  const status: CallbackStatus = initialErrorMessage === null ? asyncState.status : "error";
  const errorMessage = initialErrorMessage ?? asyncState.errorMessage;

  // 画面に出せるのは丸めたメッセージなので、切り分けに要る生の値は運用側の経路へ送る。
  // ここを消すと、問い合わせを受けても client_id の設定ミスか redirect_uri の不一致か
  // 管理ポリシーによる遮断かを区別する手立てが無くなる。
  //
  // 送るのは、自分が始めた認証の戻りだと確かめられた場合だけにする。
  // このページは誰でも叩ける公開 GET なので、state を見ずに送ると、攻撃ページが
  // iframe で任意の error を並べるだけで運用ログを汚染でき、しかも
  // POST /client_errors は送信元 IP あたり毎分10件で頭打ちのため、被害者の枠を
  // 使い切らせて正規のレポートまで落とせる。
  //
  // 空の ?error= も送らない。表示側は「エラー無し」と判定しており、ここだけ
  // 通報すると成功したログインに対して失敗の記録が残る。
  useEffect(() => {
    if (providerErrorKey === null || state === null) {
      return;
    }

    if (window.sessionStorage.getItem(callbackStateKey) !== state) {
      return;
    }

    reportClientError({
      message: `google oauth callback error=${truncate(error)} description=${truncate(errorDescription)}`,
      source: "google-callback"
    });
  }, [error, errorDescription, providerErrorKey, state]);

  useEffect(() => {
    if (!code || !state || initialErrorMessage !== null || asyncState.status !== "loading") {
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
      } catch (cause) {
        setCallbackState({
          codeVerifier: null,
          errorMessage: cause instanceof Error ? cause.message : t("callbackFailure"),
          returnTo,
          status: "error"
        });
      }
    })();
  }, [asyncState.status, code, initialErrorMessage, router, state, t]);

  // 見出しと本文は3つの状態それぞれに対応させる。error のときに success の文言を出すと、
  // 「認証に成功しました／元の画面へ戻ります」の下にエラーが並ぶ画面になる。
  const headingKey = callbackHeadingKeys[status];
  const descriptionKey = callbackDescriptionKeys[status];

  return (
    <main className="home-shell">
      <section className="hero-card auth-callback-card">
        <p className="auth-status">
          <FontAwesomeIcon icon={status === "error" ? faCircleExclamation : faCircleNotch} spin={status === "loading"} />
          <span>{t(headingKey)}</span>
        </p>
        {descriptionKey === null ? null : <p className="hero-copy">{t(descriptionKey)}</p>}
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
