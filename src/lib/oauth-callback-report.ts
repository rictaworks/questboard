// OAuth コールバックの失敗について「何を運用側へ送るか」の判断。
//
// 3つの相反する要求の交点にある。
//
//   1. 画面に出せない失敗の原因を切り分けられること。利用者に見せられるのは
//      「キャンセルされた」か「Google 側で中断された」かまでで、client_id の
//      設定ミス・redirect_uri_mismatch・管理ポリシー遮断の区別は運用側にしか
//      要らず、しかしそれが無いと問い合わせに答えられない。
//
//   2. 攻撃者が書いた文章をログへ流し込めないこと。この経路は誰でも叩ける
//      公開 GET で、error も error_description も任意の文字列を取れる。
//
//   3. POST /client_errors の毎分10件/IP という枠を、攻撃者にも自分自身の
//      リロードにも使い切らせないこと。使い切ると同じ IP からの正規レポートが
//      落ちる（オフィス NAT の下では無関係な利用者まで巻き添えになる）。
//
// 判断を React の effect に埋めるとブラウザ無しでは検証できないため、
// 純粋関数として切り出す。ストレージの読み書きと送信は呼び出し側の仕事。

// 通報に載せる生の値の上限。state を確かめてから送るとはいえ、値そのものは
// クエリ由来で長さを選べるため、ログを1件で埋められないようにしておく。
const REPORTED_VALUE_MAX_LENGTH = 200;

// 重複した error_description を連結するときの区切り。連結する側（コールバックの
// ページ）と、ここで分割して丸める側で必ず同じでなければならない。
export const DESCRIPTION_SEPARATOR = ' | ';

// 説明が重複して届いたとき、実際の原因は後ろの値にあることがある
// （1つ目が定型文、2つ目が redirect_uri_mismatch）。連結してから先頭 200 文字で
// 切ると、残す意味のある方が丸ごと消える。上限は全体で守りつつ、各エントリへ
// 分け合う。分け合う数を絞らないと1件あたりが数文字になり、どれも読めなくなる。
const REPORTED_DESCRIPTION_MAX_ENTRIES = 4;

// 省略したエントリ数を添える印。黙って捨てると、運用側からは「説明はこれで全部」に
// 見えてしまう。
const DESCRIPTION_OMITTED_PREFIX = '+';
const DESCRIPTION_OMITTED_SUFFIX = ' more';

export const callbackReportReasons = {
  missingCode: 'missing-code',
  missingState: 'missing-state',
  providerError: 'provider-error'
} as const;

export type CallbackMissingParamKey = 'callbackMissingCode' | 'callbackMissingState';

export type CallbackReport = {
  // 通報の本文。
  message: string;
  // 同じコールバックを見分ける印。呼び出し側はこれをストレージに残し、
  // 一致する間は送り直さない。リロードのたびに送ると、ログインできない
  // 利用者が連打するだけで枠を使い切る。
  marker: string;
};

export function buildCallbackReport({
  embedded,
  error,
  errorDescription,
  missingParamKey,
  providerErrorKey,
  state,
  storedState
}: {
  embedded: boolean;
  error: string | null;
  errorDescription: string | null;
  missingParamKey: CallbackMissingParamKey | null;
  providerErrorKey: string | null;
  state: string | null;
  storedState: string | null;
}): CallbackReport | null {
  // 埋め込まれた文書からは送らない（要求3）。攻撃ページが iframe を10枚
  // 並べるだけで被害者の枠を使い切らせられる経路を塞ぐ。
  if (embedded) {
    return null;
  }

  const reason = readReason(providerErrorKey, missingParamKey);
  if (reason === null) {
    return null;
  }

  // このタブで認証を始めた証拠が無いなら、何も送らない（要求3）。
  //
  // 埋め込みを塞いでも足りない。攻撃ページはポップアップを1枚開いて location を
  // 書き換え続けられる。開かれた文書は最上位のままなので埋め込み判定では止まらず、
  // 被害者の IP から毎分10件の枠をいくらでも消費させられる。自分が保存した state が
  // 残っていることを、送ってよいことの条件にする。攻撃者はこの値を作れない。
  //
  // 代償として、別タブで認証を始めた場合の失敗は通報されない（sessionStorage は
  // タブ単位）。第三者が正規のレポートを妨害できる経路を残すよりは、その診断を
  // 落とすほうを選ぶ。
  if (storedState === null) {
    return null;
  }

  // state が一致したときだけ、自分が始めた認証の戻りだと確かめられる。
  // このときに限り生の値を載せる（要求1）。
  const stateVerified = state !== null && storedState === state;

  if (!stateVerified) {
    // 確かめられない場合も黙らない。クラッシュから復元した、Google が state を
    // 落とした・変えたという、まさに切り分けが要る場面がここに落ちる。
    // ただしクエリ由来の値は一切載せない（要求2）。
    //
    // 印にもクエリ由来の値を使わない。使うと state を変えるだけで別の通報として
    // 何度でも送れてしまう。代わりに保存済みの state を使うことで、印は認証試行
    // ごとに1つになる（同じタブで始め直せば新しい state が保存され、その失敗は
    // 改めて通報される）。
    return {
      marker: `${reason}|state-unverified|${storedState}`,
      message: `google oauth callback reason=${reason} state-unverified`
    };
  }

  return {
    marker: `${reason}|${storedState}|${error ?? ''}`,
    message:
      `google oauth callback reason=${reason} error=${truncate(error)}`
      + ` description=${truncateDescription(errorDescription)}`
  };
}

// 通報を送り、同じコールバックからは1回だけ送るための印を管理する。
//
// 印が要るのは、ログインできない利用者がリロードを連打するのが自然な反応で、
// そのたびに送ると毎分10件/IP の枠を使い切るため（枠が尽きると同じ IP からの
// 正規レポートまで落ち、オフィス NAT の下では無関係な利用者が巻き添えになる）。
//
// ストレージと送信は呼び出し側から渡す。ブラウザ無しで検証できるようにするため。
export async function deliverCallbackReportOnce(
  report: CallbackReport,
  marker: {
    read: () => string | null;
    write: (value: string) => boolean;
    forget: () => boolean;
  },
  send: (message: string) => Promise<boolean>
): Promise<void> {
  if (marker.read() === report.marker) {
    return;
  }

  // 送る前に印を残す。送信は非同期なので、後に置くと連続したマウントで二重に
  // 送られる。ストレージが使えない環境では書けないが、その場合も送ること自体は
  // 続ける（診断が完全に消えるより、重複を許すほうがまだよい）。
  marker.write(report.marker);

  // 送信経路が投げても、それを通報し直す手立ては無い（経路そのものが壊れている）。
  // 未処理の reject にすると ClientErrorBridge が拾って送信失敗のループになるため、
  // ここで受け止めて「届かなかった」として扱う。原因は devtools に残す。
  const delivered = await send(report.message).catch((cause: unknown) => {
    console.error('[oauth-callback-report] 通報の送信が例外で終わった', cause);
    return false;
  });

  if (delivered) {
    return;
  }

  // 届かなかった通報まで送信済みとして抑止すると、この認証試行の診断は永久に
  // 失われる。オフライン・CORS 拒否・Sentry の読み込み失敗はいずれも復旧しうるので、
  // 印を取り消して次の読み直しで送り直せるようにする。
  //
  // ただし消してよいのは自分が書いた印だけ。印は1つしか置けないため、別の
  // コールバックの通報が並行して走り、先に成功して書き換えていることがある。
  // 無条件に消すと、成功した通報の抑止まで解除され、再描画やリロードで重複して
  // 送られてレート枠を削る。
  if (marker.read() !== report.marker) {
    return;
  }

  marker.forget();
}

function readReason(
  providerErrorKey: string | null,
  missingParamKey: CallbackMissingParamKey | null
): string | null {
  if (providerErrorKey !== null) {
    return callbackReportReasons.providerError;
  }

  if (missingParamKey === 'callbackMissingCode') {
    return callbackReportReasons.missingCode;
  }

  if (missingParamKey === 'callbackMissingState') {
    return callbackReportReasons.missingState;
  }

  return null;
}

function truncate(value: string | null, maxLength: number = REPORTED_VALUE_MAX_LENGTH): string {
  if (value === null) {
    return '';
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

// 重複した説明を、全体の上限を守りながらどのエントリからも一定量残す形に丸める。
function truncateDescription(value: string | null): string {
  if (value === null) {
    return '';
  }

  const entries = value.split(DESCRIPTION_SEPARATOR);
  if (entries.length === 1) {
    return truncate(value);
  }

  const kept = entries.slice(0, REPORTED_DESCRIPTION_MAX_ENTRIES);
  const perEntryMaxLength = Math.floor(REPORTED_VALUE_MAX_LENGTH / kept.length);
  const omitted = entries.length - kept.length;
  const parts = kept.map((entry) => truncate(entry, perEntryMaxLength));

  if (omitted > 0) {
    parts.push(`${DESCRIPTION_OMITTED_PREFIX}${omitted}${DESCRIPTION_OMITTED_SUFFIX}`);
  }

  return parts.join(DESCRIPTION_SEPARATOR);
}
