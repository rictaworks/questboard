import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {NextIntlClientProvider} from 'next-intl';
import {getMessages, getTranslations} from 'next-intl/server';

import ClientErrorBridge from '@/components/client-error-bridge';
import QueryProvider from '@/components/query-provider';
import {defaultLocale} from '@/i18n/routing';

import './globals.css';

// タイトルが未設定だとブラウザのタブが生の URL 表示になり、複数タブを開いたときに
// どれが questboard か分からない（Issue #100）。
// 対応言語は日本語のみなので、ロケールごとの出し分けは行わない。
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Metadata');

  return {
    description: t('description'),
    title: t('title')
  };
}

// <html> を出力する唯一のレイアウト。全ページと 404 がこの中に描画されるため、
// lang・globals.css・エラー計測はここに置けば漏れなく行き渡る。
//
// QueryProvider と ClientErrorBridge もここに置く。動的セグメントを持たない
// レイアウトなので、ページ遷移で再マウントされず React Query のキャッシュも保たれる。
export default async function RootLayout({children}: {children: ReactNode}) {
  const messages = await getMessages();

  return (
    <html lang={defaultLocale}>
      <body>
        <QueryProvider>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        </QueryProvider>
        <ClientErrorBridge />
      </body>
    </html>
  );
}
