import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {getLocale, getTranslations} from 'next-intl/server';

import ClientErrorBridge from '@/components/client-error-bridge';
import QueryProvider from '@/components/query-provider';
import {isRtlLocale} from '@/i18n/routing';

import './globals.css';

// <html> はこのレイアウトだけが出力する。[locale]/layout.tsx 側に置くと、
// [locale] セグメントの外で発生する 404（ドット付きパス・不正なロケール等）が
// どのレイアウトにも包まれず、lang / dir / title / globals.css を一切持たない
// Next 組み込みのエラーシェルで返ってしまう。
// ロケールは next-intl のミドルウェアがリクエストヘッダーに載せた値を getLocale()
// で読む。URL のパラメータではなくヘッダー由来なので、[locale] の外側でも解決できる。
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'Metadata'});

  // タイトルが未設定だとブラウザのタブが生の URL 表示になり、複数タブを開いたときに
  // どれが questboard か分からない（Issue #100）。
  return {
    description: t('description'),
    title: t('title')
  };
}

export default async function RootLayout({children}: {children: ReactNode}) {
  const locale = await getLocale();
  const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';

  // QueryProvider と ClientErrorBridge はロケールセグメントの外側に置く。
  // [locale]/layout.tsx に置くとロケール切替のたびにアンマウントされ、
  // React Query のキャッシュが毎回捨てられる。
  return (
    <html lang={locale} dir={dir}>
      <body>
        <QueryProvider>{children}</QueryProvider>
        <ClientErrorBridge />
      </body>
    </html>
  );
}
