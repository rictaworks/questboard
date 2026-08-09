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
// 配列も受ける。
//
// 前後の空白は落とす。下流は access_denied と厳密一致で「利用者がキャンセルした」と
// 判定するため、" access_denied" が届くと設定エラー扱いになる。
// 値が食い違うときは access_denied を優先する。利用者が同意画面でキャンセルした
// という事実は、連鎖の途中で付いた別の理由より確かで、伝えるべき内容も変わる。
function readErrorParam(value: string | string[] | undefined): string | null {
  const entries = (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  if (entries.length === 0) {
    return null;
  }

  return entries.includes("access_denied") ? "access_denied" : entries[0];
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
  const code = readParam(params.code);
  const error = readErrorParam(params.error);
  const state = readParam(params.state);

  // key を付けて、コールバックが変われば作り直させる。GoogleCallback は
  // トークン交換の途中経過を useState に持つため、クライアント遷移で同じ
  // インスタンスが使い回されると、前回失敗した理由（例: 認証状態が一致しません）を
  // 抱えたまま新しい code を無視し続ける。
  return (
    <NextIntlClientProvider messages={messages}>
      <GoogleCallback
        key={`${code}|${state}|${error}`}
        code={code}
        error={error}
        errorDescription={readErrorParam(params.error_description)}
        state={state}
      />
    </NextIntlClientProvider>
  );
}
