import createNextIntlPlugin from 'next-intl/plugin';
import type {NextConfig} from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  typedRoutes: true,
  experimental: {
    // src/app/global-not-found.tsx を有効にする。どのルートにも一致しない
    // パスの 404 に lang / dir / globals.css を持つシェルを与えるために必須。
    globalNotFound: true
  }
};

export default withNextIntl(nextConfig);
