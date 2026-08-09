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
export function reportClientError(payload: {
  message: string;
  source: string;
  stack?: string | null;
  line?: number | null;
  column?: number | null;
}) {
  if (sentryEnabled()) {
    captureWithSentry(payload.message, payload.source);
    return;
  }

  sendToBackend(payload);
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
function reportDeliveryFailure(cause: unknown) {
  console.error('[client-error-report] 通報の送信に失敗した', cause);
}

// Sentry は src/instrumentation-client.ts で初期化済み。ここで再初期化はしない。
// 静的 import にすると、Sentry を使わない環境の共通チャンクにも実装が載るため
// 動的 import で読む。
//
// チャンクの取得失敗（デプロイ直後の古いハッシュ、オフライン）でも import は
// reject する。捕捉しないと未処理の reject として残る。
function captureWithSentry(message: string, source: string) {
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.captureMessage(message, {
        level: 'error',
        tags: {source}
      });
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
}) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    return;
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

  if (deliveredByBeacon(`${backendUrl}/client_errors`, body)) {
    return;
  }

  // fetch の reject（バックエンド停止、CORS 拒否、オフライン）を未処理のまま
  // 残さない。残すと unhandledrejection として ClientErrorBridge に拾われ、
  // 送信失敗のループになる。
  void fetch(`${backendUrl}/client_errors`, {
    body,
    headers: {
      'Content-Type': 'application/json'
    },
    keepalive: true,
    method: 'POST',
    mode: 'cors'
  }).catch(reportDeliveryFailure);
}

// sendBeacon は送信を断ったときに false を返すが、CSP の connect-src で
// 拒否された場合は例外を投げる。素通しすると reportClientError の呼び出し元
// （useEffect やイベントリスナー）まで例外が抜け、window の error イベント経由で
// 同じ通報が繰り返される。捕捉して fetch 経路へ回す。
function deliveredByBeacon(endpoint: string, body: string): boolean {
  if (!navigator.sendBeacon) {
    return false;
  }

  try {
    return navigator.sendBeacon(endpoint, new Blob([body], {type: 'application/json'}));
  } catch (cause) {
    reportDeliveryFailure(cause);
    return false;
  }
}
