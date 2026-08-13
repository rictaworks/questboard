"use client";

import {faCircleExclamation, faCircleNotch, faUserCheck} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {useTranslations} from "next-intl";

import {
  isTopLevelDocument,
  readSessionItem,
  removeSessionItem,
  writeSessionItem
} from "@/lib/browser-storage";
import {reportClientError} from "@/lib/client-error-report";
import {
  xAuthStorageKeys,
  loadRecaptchaToken,
  readXAuthSettings
} from "@/lib/x-auth";
import {
  buildCallbackReport,
  deliverCallbackReportOnce,
  type CallbackMissingParamKey
} from "@/lib/oauth-callback-report";

const callbackStateKey = xAuthStorageKeys.state;

// 通報済みのコールバックを覚えておく場所。ログインできない利用者がリロードを
// 連打するのは自然な反応で、そのたびに送ると毎分10件/IP の枠を使い切る。
const reportedCallbackKey = "questboard.x.reportedCallback";

const reportSource = "x-callback";

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

// X が返す error の値は access_denied（利用者がキャンセル）のほか、
// invalid_request や admin_policy_enforced など設定・ポリシー由来のものがある。
// 利用者に伝えられるのは「キャンセルされた」か「X 側で中断された」かの区別まで。
//
// 生の値は画面に出さない。この経路は誰でも叩ける公開 GET で error は任意の文字列を
// 取れるため、そのまま描画すると攻撃者が書いた文章を製品自身のエラーメッセージとして
// 表示できてしまう。切り分けに要る生の値は reportClientError でバックエンドのログへ送る
// （何を載せるかの判断は @/lib/oauth-callback-report に切り出してある）。
function readProviderErrorKey(error: string | null): "callbackDenied" | "callbackProviderError" | null {
  if (error === null || error.trim() === "") {
    return null;
  }

  return error.trim() === "access_denied" ? "callbackDenied" : "callbackProviderError";
}

export default function XCallback({
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

  // X がエラーを返した場合は、code の有無に関わらずそれを理由として表示する。
  // 見ずに code 欠落として扱うと、同意画面でキャンセルしただけの利用者に
  // 「認可コードが見つかりません」という無関係な原因が示される。
  const providerErrorKey = readProviderErrorKey(error);

  // code の欠落と state の欠落を1つの真偽値に潰さない。潰すと、X が実際には
  // 認可コードを送っているのに「認可コードが見つかりません」と表示することになり、
  // 利用者もサポートも存在しない問題を探し回る。state はプライバシー拡張による
  // 除去や中間リダイレクトで単独で落ちうる。
  const missingParamKey: CallbackMissingParamKey | null = !code
    ? "callbackMissingCode"
    : (!state ? "callbackMissingState" : null);

  const initialErrorMessage = providerErrorKey !== null
    ? t(providerErrorKey)
    : (missingParamKey === null ? null : t(missingParamKey));

  // 失敗理由は props から毎回導出する。useState の遅延初期化に閉じ込めると、
  // クライアント遷移で同じインスタンスが使い回されたときに初期化関数が再実行されず、
  // 画面が「X ログインを完了しています」のまま止まる。
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
  // 何を載せるか（state が確かめられたときだけ生の値を載せる、埋め込まれた文書からは
  // 送らない）の判断は buildCallbackReport が持つ。ここはストレージと送信だけを担う。
  useEffect(() => {
    const report = buildCallbackReport({
      embedded: !isTopLevelDocument(),
      error,
      errorDescription,
      missingParamKey,
      providerErrorKey,
      state,
      storedState: readSessionItem(callbackStateKey)
    });

    if (report === null) {
      return;
    }

    // 同じコールバックからは1回だけ送る。ただし届かなかった通報を送信済みとして
    // 抑止すると診断が永久に失われるため、印の管理は送信結果まで見る
    // deliverCallbackReportOnce に任せる。ここはストレージと送信の実体を渡すだけ。
    void deliverCallbackReportOnce(
      report,
      {
        forget: () => removeSessionItem(reportedCallbackKey),
        read: () => readSessionItem(reportedCallbackKey),
        write: (value) => writeSessionItem(reportedCallbackKey, value)
      },
      (message) => reportClientError({message, source: reportSource})
    );
  }, [error, errorDescription, missingParamKey, providerErrorKey, state]);

  useEffect(() => {
    if (!code || !state || initialErrorMessage !== null || asyncState.status !== "loading") {
      return;
    }

    void (async () => {
      const storedState = readSessionItem(callbackStateKey);
      const codeVerifier = readSessionItem(xAuthStorageKeys.codeVerifier);
      const rawReturnTo = readSessionItem(xAuthStorageKeys.returnTo);
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
        const settings = readXAuthSettings();
        const recaptchaToken = await loadRecaptchaToken(settings.recaptchaSiteKey, "login");
        const response = await fetch(`${settings.backendUrl}/auth/x_sessions`, {
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

        removeSessionItem(xAuthStorageKeys.codeVerifier);
        removeSessionItem(xAuthStorageKeys.state);
        removeSessionItem(xAuthStorageKeys.returnTo);
        removeSessionItem(reportedCallbackKey);
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
