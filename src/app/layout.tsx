import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {NextIntlClientProvider} from 'next-intl';
import {getTranslations} from 'next-intl/server';

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
// messages は渡さない。Server Component から描画した NextIntlClientProvider は
// 自分で getMessages() を呼ぶため（next-intl 4.x の NextIntlClientProviderServer）、
// ここで渡すとメッセージの出所が2箇所あるように見えるだけになる。
// 実際の設定元は src/i18n/request.ts。
export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang={defaultLocale}>
      <body>
        <QueryProvider>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </QueryProvider>
        <ClientErrorBridge />
      </body>
    </html>
  );
}
