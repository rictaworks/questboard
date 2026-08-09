import {NextIntlClientProvider} from "next-intl";

import GoogleCallback from "@/components/google-callback";
import {clientMessages} from "@/i18n/client-messages";

// 同名のクエリパラメータが複数回現れると Next は配列を渡す（?code=a&code=b）。
// 配列をそのまま下流に流すと truthy なので「必須パラメータが無い」判定を素通りし、
// バックエンドのトークン交換に配列が届いて 502 になる。利用者にはログイン
// コールバック画面で生のバックエンドエラーが出る。
// 文字列でないものは受け取らなかったものとして扱い、callbackMissingCode の
// メッセージに寄せる。
function readParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

// error は失敗の理由でしかなく、下流でトークン交換に使うことはない。重複して
// 届いたからといって捨てると、キャンセルしただけの利用者に「認可コードが
// 見つかりません」という無関係な原因が示される状態に戻ってしまう。
// プロキシやリダイレクト連鎖でパラメータが重複しても理由を保てるよう、
// 配列のときは最初の文字列を採る。
function readErrorParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.find((entry) => entry.trim() !== "") ?? null;
  }

  return readParam(value);
}

export default async function GoogleCallbackPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const messages = await clientMessages(["Auth"]);

  // Google は同意画面でのキャンセルや設定不備を、code ではなく error クエリで返す
  // （?error=access_denied&error_description=...）。これを渡さないと code 欠落と
  // 同じ経路に落ち、利用者には「認証に成功しました」と「認可コードが見つかりません」が
  // 同時に出る画面になる。
  //
  // error_description も渡す。画面には出さないが、invalid_client（client_id の
  // 設定ミス）・redirect_uri_mismatch・admin_policy_enforced を切り分けられるのは
  // この2つだけで、捨てると問い合わせ時に原因を追えなくなる。
  return (
    <NextIntlClientProvider messages={messages}>
      <GoogleCallback
        code={readParam(params.code)}
        error={readErrorParam(params.error)}
        errorDescription={readErrorParam(params.error_description)}
        state={readParam(params.state)}
      />
    </NextIntlClientProvider>
  );
}
