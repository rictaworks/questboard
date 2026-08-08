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
  return (
    <NextIntlClientProvider messages={messages}>
      <GoogleCallback
        code={readParam(params.code)}
        error={readParam(params.error)}
        state={readParam(params.state)}
      />
    </NextIntlClientProvider>
  );
}
