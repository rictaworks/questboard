import {NextIntlClientProvider} from "next-intl";

import XCallback from "@/components/x-callback";
import {clientMessages} from "@/i18n/client-messages";
import {DESCRIPTION_SEPARATOR} from "@/lib/oauth-callback-report";

// 同名のクエリパラメータが複数回現れると Next は配列を渡す（?code=a&code=b）。
// 配列をそのまま下流に流すと truthy なので「必須パラメータが無い」判定を素通りし、
// バックエンドのトークン交換に配列が届いて 502 になる。
//
// かといって配列を捨ててはいけない。クエリを再付与するリバースプロキシや
// リダイレクト連鎖を挟むデプロイでは code と state が常に重複するため、捨てると
// そのデプロイでは X ログインが一切成立しなくなる（同じ連鎖を readErrorParam は
// 明示的に想定しており、致命的でない error だけを守る理由が無い）。
//
// 先頭を採る。state は下流で sessionStorage の保存値と厳密比較されるので、
// 連鎖の途中で別の値が紛れ込んでも「認証状態が一致しません」で止まり、
// 誤った state のまま進むことはない。
function readParam(value: string | string[] | undefined): string | null {
  const entries = toEntries(value);

  return entries.length === 0 ? null : entries[0];
}

// error は失敗の理由でしかなく、下流でトークン交換に使うことはない。
// 値が食い違うときは access_denied を優先する。利用者が同意画面でキャンセルした
// という事実は、連鎖の途中で付いた別の理由より確かで、伝えるべき内容も変わる。
function readErrorParam(value: string | string[] | undefined): string | null {
  const entries = toEntries(value);

  if (entries.length === 0) {
    return null;
  }

  return entries.includes("access_denied") ? "access_denied" : entries[0];
}

// error_description は X が書く自由文で、error のような語彙は持たない。
// readErrorParam を流用してはいけない。あの関数は値をリテラル access_denied へ
// 潰し、先頭以外を捨てる。"access_denied by administrator" のような本文は
// 潰され、重複した本文は片方が失われる。invalid_client・redirect_uri_mismatch・
// admin_policy_enforced を切り分けられるのはこの本文だけなので、潰した時点で
// 問い合わせに答える手立てが無くなる。
//
// 重複は連結して残す。どちらが X の意図した本文かは判断できず、
// 選ぶより両方を運用側に見せたほうが切り分けに近い。
//
// 区切りは通報側（@/lib/oauth-callback-report）と共有する。あちらは連結した本文を
// この区切りで分割し直し、上限を各エントリへ分け合って丸める。ここで独自に決めると
// 分割が境界を見失い、後ろの説明が先頭の値ごと切り捨てられる。
function readDescriptionParam(value: string | string[] | undefined): string | null {
  const entries = toEntries(value);

  return entries.length === 0 ? null : entries.join(DESCRIPTION_SEPARATOR);
}

// 前後の空白は落とす。下流は access_denied と厳密一致で「利用者がキャンセルした」と
// 判定するため、" access_denied" が届くと設定エラー扱いになる。
function toEntries(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export default async function XCallbackPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const messages = await clientMessages(["Auth"]);

  // X は同意画面でのキャンセルや設定不備を、code ではなく error クエリで返す
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

  // key を付けて、コールバックが変われば作り直させる。XCallback は
  // トークン交換の途中経過を useState に持つため、クライアント遷移で同じ
  // インスタンスが使い回されると、前回失敗した理由（例: 認証状態が一致しません）を
  // 抱えたまま新しい code を無視し続ける。
  return (
    <NextIntlClientProvider messages={messages}>
      <XCallback
        key={`${code}|${state}|${error}`}
        code={code}
        error={error}
        errorDescription={readDescriptionParam(params.error_description)}
        state={state}
      />
    </NextIntlClientProvider>
  );
}
