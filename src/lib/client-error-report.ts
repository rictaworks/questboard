import {sanitizeClientErrorUrl} from '@/lib/sentry-sanitizer';
import {sentryEnabled} from '@/lib/sentry-config';

// 画面に出せない失敗の詳細を、運用側が読める場所へ送る唯一の経路。
//
// console.error はどこからも購読されていないため、書いても利用者の devtools に
// 残るだけで運用には届かない。
//
// 送り先は SPEC/api/rails-backend.md の運用規約に従う。例外は Sentry を第一経路と
// して集約し、Sentry 未設定のときだけ POST /client_errors と Rails のログへ
// フォールバックする。両方に送ると、アラートもグルーピングも無いログ側に
// 診断が分断される。
//
// 届いたかどうかを返す。呼び出し側には「同じ失敗を何度も送らない」ために送信済みの
// 印を残すものがあり（google-callback）、送れなかった通報まで送信済みとして扱うと、
// オフライン・CORS 拒否・Sentry の読み込み失敗で消えた診断がその試行について
// 二度と得られなくなる。返り値は必ず解決する（reject させると ClientErrorBridge が
// それを拾い、送信失敗のループになる）。
export function reportClientError(payload: {
  message: string;
  source: string;
  stack?: string | null;
  line?: number | null;
  column?: number | null;
}): Promise<boolean> {
  if (sentryEnabled()) {
    return captureWithSentry(payload.message, payload.source);
  }

  return sendToBackend(payload);
}

// 送信の失敗は、この関数の内側で必ず受け止める。
//
// ClientErrorBridge は window の error と unhandledrejection を購読して
// reportClientError に渡すため、送信経路が未処理の reject や未捕捉の例外を残すと、
// その失敗自体が次の通報の材料になり「送信失敗 → 再通報 → 同じ失敗」のループが
// 回り続ける。利用者のブラウザが CPU と通信を消費し続け、しかも
// POST /client_errors は送信元 IP あたり毎分10件で頭打ちのため、
// 正規のレポートまで落ちる。
//
// 失敗をここから通報し直す手立ては無い（通報経路そのものが壊れている）。
// devtools から追えるように console.error にだけ残す。console.error は error
// イベントも unhandledrejection も発火しないので、このループには戻らない。
function reportDeliveryFailure(cause: unknown): false {
  console.error('[client-error-report] 通報の送信に失敗した', cause);
  return false;
}

// Sentry は src/instrumentation-client.ts で初期化済み。ここで再初期化はしない。
// 静的 import にすると、Sentry を使わない環境の共通チャンクにも実装が載るため
// 動的 import で読む。
//
// チャンクの取得失敗（デプロイ直後の古いハッシュ、オフライン）でも import は
// reject する。捕捉しないと未処理の reject として残る。
//
// captureMessage が返った時点を「届いた」とする。Sentry は送信をキューに持つため
// ネットワーク到達までは確かめられないが、ここから観測できるのはこの境界まで。
function captureWithSentry(message: string, source: string): Promise<boolean> {
  return import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.captureMessage(message, {
        level: 'error',
        tags: {source}
      });
      return true;
    })
    .catch(reportDeliveryFailure);
}

// バックエンドの URL が未設定のときは送らない。設定不備は起動時に
// readGoogleAuthSettings が例外で知らせる領分で、ここで握り潰す対象ではない。
function sendToBackend(payload: {
  message: string;
  source: string;
  stack?: string | null;
  line?: number | null;
  column?: number | null;
}): Promise<boolean> {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    return Promise.resolve(false);
  }

  const body = JSON.stringify({
    column: payload.column ?? null,
    line: payload.line ?? null,
    message: payload.message,
    source: payload.source,
    stack: payload.stack ?? null,
    url: sanitizeClientErrorUrl(window.location.href),
    user_agent: navigator.userAgent
  });

  // navigator.sendBeacon は使わない。
  //
  // beacon はキューに入れた時点で true を返し、その後の失敗を呼び出し側へ伝える
  // 手段が無い。バックエンドは別オリジンにあり、application/json は CORS の
  // セーフリスト外なのでプリフライトを伴う。許可オリジンの設定漏れやプラット
  // フォーム側の OPTIONS 遮断があると、true を受け取った後に黙って捨てられ、
  // フォールバックも走らないまま通報が消える。運用側から見ると client_errors の
  // ログは空のまま、利用者は実際にクラッシュしているという最悪の見え方になる。
  //
  // keepalive: true の fetch はページ遷移をまたいでも送信され、失敗は reject として
  // 観測できる。beacon を使う理由が残らない。
  //
  // reject（バックエンド停止、CORS 拒否、オフライン）は必ず捕捉する。残すと
  // unhandledrejection として ClientErrorBridge に拾われ、送信失敗のループになる。
  //
  // 受理された（2xx）ときだけ「届いた」とする。429 でレート枠を使い切っている間も
  // false を返すが、その状況では再送も同じく落ちるだけで、枠が戻れば送り直せる。
  return fetch(`${backendUrl}/client_errors`, {
    body,
    headers: {
      'Content-Type': 'application/json'
    },
    keepalive: true,
    method: 'POST',
    mode: 'cors'
  })
    .then((response) => {
      if (response.ok) {
        return true;
      }

      return reportDeliveryFailure(new Error(`client_errors が ${response.status} を返した`));
    })
    .catch(reportDeliveryFailure);
}
