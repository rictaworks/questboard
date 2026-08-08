import createMiddleware from 'next-intl/middleware';
import {NextRequest, NextResponse} from 'next/server';

import {
  isDecodablePathname,
  LOCALE_HEADER,
  PATHNAME_HEADER,
  requiresDefaultLocale,
  shouldSkipLocaleRouting
} from '@/i18n/middleware-routing';
import {defaultLocale, locales, type Locale} from '@/i18n/routing';

const intlMiddleware = createMiddleware({
  defaultLocale,
  locales: [...locales]
});

// ロケール判定だけを行いたいときに next-intl へ渡すパス。ロケール接頭辞が無い
// ルートなので、応答は必ず /{locale} へのリダイレクトになる。
const LOCALE_PROBE_PATHNAME = '/';

// リクエストのロケールを判定する。
//
// 判定規則（NEXT_LOCALE クッキー → Accept-Language → 既定ロケール）は自前で
// 実装しない。Accept-Language の q 値の扱いを誤りやすく、next-intl が
// @formatjs/intl-localematcher と negotiator で既に解いている問題でもある。
// 代わりに next-intl のミドルウェアへ '/' を渡し、その /{locale} リダイレクトから
// 判定結果を取り出す。判定に使われるのはクッキーと Accept-Language だけで、
// LOCALE_HEADER は読まれないため、クライアントが表示言語を偽装する経路にならない。
function detectLocale(request: NextRequest): Locale {
  const probeUrl = new URL(LOCALE_PROBE_PATHNAME, request.nextUrl.origin);
  const probeResponse = intlMiddleware(new NextRequest(probeUrl, {headers: request.headers}));
  const location = probeResponse.headers.get('location');

  // フォールバックせず失敗させる。既定ロケールで代用すると、next-intl の更新で
  // 応答の形が変わったときに「全ロケールが日本語に退行する」という形で静かに
  // 壊れる。ここで投げれば test/scaffold.test.mjs が CI で気付く。
  if (location === null) {
    throw new Error(
      `next-intl のロケール判定が ${LOCALE_PROBE_PATHNAME} のリダイレクトを返さなかった（status: ${probeResponse.status}）`
    );
  }

  const detected = new URL(location, request.nextUrl.origin).pathname.split('/')[1] ?? '';

  if (!locales.includes(detected as Locale)) {
    throw new Error(`next-intl のロケール判定が未知のロケールを返した: ${detected}`);
  }

  return detected as Locale;
}

// 実ファイル要求はリダイレクトも rewrite もせずそのまま通す。どちらを行っても
// public/ 配下の実ファイル（所有権確認用の HTML、ACME チャレンジトークン、
// apple-app-site-association 等）が配信されなくなる。
function passThrough(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);

  // クライアントが送ったロケールは信じない。素通しするパスでは next-intl が
  // 上書きしないため、素通しすると表示言語をリクエストヘッダーで操作できる。
  // ただし削除して既定ロケールに任せると、実ファイルが無かった場合の 404 が
  // 全利用者に日本語で返る。サーバー側で判定した値に差し替える。
  requestHeaders.set(LOCALE_HEADER, detectLocale(request));

  // 実ファイルが存在しなかった場合、このパスは [locale] セグメントとして
  // app router に届く。ロケールの検証をやり直せるよう、元のパスを渡す。
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);

  return NextResponse.next({request: {headers: requestHeaders}});
}

// ミドルウェア自体はほぼ全リクエストで動かし、ロケール解決を行うかどうかを
// shouldSkipLocaleRouting() で分岐する。
//
// 「静的アセットの拡張子を matcher から除外する」書き方にはしない。除外すると
// そのパスではミドルウェアが動かず、クライアントが送った LOCALE_HEADER が
// そのままサーバーコンポーネントに届いて表示言語を操作できてしまう。
export default function middleware(request: NextRequest): NextResponse {
  const {pathname} = request.nextUrl;

  // 壊れたパスを next-intl に渡すと、ヘッダー未処理のまま素通しされる。
  // ロケール解決の対象にはせず、こちらでヘッダーを整えてから Next に返す。
  if (!isDecodablePathname(pathname)) {
    return passThrough(request);
  }

  if (shouldSkipLocaleRouting(pathname)) {
    return passThrough(request);
  }

  // 既定ロケールへ寄せる入口は next-intl のロケール検出に渡さない。
  // クエリは落とさずそのまま引き継ぐ。
  if (requiresDefaultLocale(pathname)) {
    const target = new URL(`/${defaultLocale}${pathname}`, request.nextUrl.origin);
    target.search = request.nextUrl.search;

    return NextResponse.redirect(target);
  }

  return intlMiddleware(request);
}

// Next.js requires `matcher` entries to be static string literals (no computed
// values).
//
// ビルド成果物と計測エンドポイントのみ、その配下（末尾のスラッシュ以降）を
// ミドルウェアの対象外にする。`_next` / `_vercel` そのものを除外してはいけない。
// これらは1セグメントのパスなので [locale] に一致してしまい、ミドルウェアを
// 通らないまま、クライアントが送った LOCALE_HEADER / PATHNAME_HEADER を持って
// サーバーコンポーネントに届く。
// それ以外の分岐は shouldSkipLocaleRouting() が担う。
export const config = {
  matcher: ['/((?!_next/|_vercel/).*)']
};
