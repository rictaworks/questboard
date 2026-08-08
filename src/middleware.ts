import createMiddleware from 'next-intl/middleware';
import {NextResponse, type NextRequest} from 'next/server';

import {LOCALE_HEADER, PATHNAME_HEADER, shouldSkipLocaleRouting} from '@/i18n/middleware-routing';
import {defaultLocale, locales} from '@/i18n/routing';

const intlMiddleware = createMiddleware({
  defaultLocale,
  locales: [...locales]
});

// ミドルウェア自体はほぼ全リクエストで動かし、ロケール解決を行うかどうかを
// shouldSkipLocaleRouting() で分岐する。
//
// 「静的アセットの拡張子を matcher から除外する」書き方にはしない。除外すると
// そのパスではミドルウェアが動かず、クライアントが送った LOCALE_HEADER が
// そのままサーバーコンポーネントに届いて表示言語を操作できてしまう。
export default function middleware(request: NextRequest): NextResponse {
  if (!shouldSkipLocaleRouting(request.nextUrl.pathname)) {
    return intlMiddleware(request);
  }

  // 実ファイル要求はリダイレクトも rewrite もせずそのまま通す。どちらを行っても
  // public/ 配下の実ファイル（所有権確認用の HTML、ACME チャレンジトークン、
  // apple-app-site-association 等）が配信されなくなる。
  const requestHeaders = new Headers(request.headers);

  // クライアントが送ったロケールは必ず捨てる。素通しするパスでは next-intl が
  // 上書きしないため、そのままだと表示言語をリクエストヘッダーで操作できる。
  requestHeaders.delete(LOCALE_HEADER);

  // 実ファイルが存在しなかった場合、このパスは [locale] セグメントとして
  // app router に届く。ロケールの検証をやり直せるよう、元のパスを渡す。
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);

  return NextResponse.next({request: {headers: requestHeaders}});
}

// Next.js requires `matcher` entries to be static string literals (no computed
// values).
//
// ビルド成果物と計測エンドポイントだけをミドルウェアの対象外にする。
// それ以外の分岐は shouldSkipLocaleRouting() が担う。
export const config = {
  matcher: ['/((?!_next(?:/|$)|_vercel(?:/|$)).*)']
};
