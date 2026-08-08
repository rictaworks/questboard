import createNextIntlPlugin from 'next-intl/plugin';
import type {NextConfig} from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// 多言語をやめる前に配布された、ロケール接頭辞つきの URL。
//
// 以前は /b/<token> を開くと /ja/b/<token> へリダイレクトしていたため、利用者が
// アドレス欄で見て、ブックマークし、チャットに貼った URL はすべて接頭辞つきだった。
// 接頭辞を落としただけでは、それらが 404 になる。共有リンクの受け取り側は
// ボードに到達する手段が無くなる（404 画面の導線はトップページに戻るだけで、
// 共有トークンを引き継がない）。
//
// ここは削除済みロケールも含めて全7つを対象にする。/ja 以外も URL としては
// 到達可能だったため、同じ理由で残っている可能性がある。
const REMOVED_LOCALE_PREFIXES = ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar'] as const;

const nextConfig: NextConfig = {
  typedRoutes: true,
  async redirects() {
    return REMOVED_LOCALE_PREFIXES.flatMap((locale) => [
      // /ja → /
      {source: `/${locale}`, destination: '/', permanent: true},
      // /ja/b/<token> → /b/<token>。クエリは Next が自動で引き継ぐ
      {source: `/${locale}/:path*`, destination: '/:path*', permanent: true}
    ]);
  }
};

export default withNextIntl(nextConfig);
