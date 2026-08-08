import createMiddleware from 'next-intl/middleware';

import {defaultLocale, locales} from '@/i18n/routing';

export default createMiddleware({
  defaultLocale,
  locales: [...locales]
});

// Next.js requires `matcher` entries to be static string literals (no computed
// values).
//
// 除外するのは API・Next の内部パス・Vercel の計測パスと、静的アセットの拡張子を
// 持つパスだけにする。「ドットを含むパスをすべて除外する」書き方にすると
// /wp-login.php のような HTML を期待するリクエストがミドルウェアを通らず、
// ロケールが決まらないまま Next 組み込みのアセット 404（lang / dir を持たない
// 空のシェル）で返ってしまう。
// 拡張子リストに載っているパスは実ファイル要求とみなし、そのまま通す。
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next(?:/|$)|_vercel(?:/|$)|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|css|js|mjs|map|txt|xml|json|webmanifest|woff|woff2|ttf|otf|eot|mp4|webm|pdf)(?:$|\\?)).*)'
  ]
};
