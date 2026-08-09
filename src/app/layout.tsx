import type {Metadata} from 'next';
import type {ReactNode} from 'react';

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
//
// NextIntlClientProvider はここには置かない。Server Component から引数なしで描画すると
// next-intl はカタログ全体をクライアントへ送るため、メッセージを使わない 404 や
// OAuth コールバックにまで ja.json 全体（BoardCanvas 名前空間を含む）が載る。
// クライアントコンポーネントを持つページ側で、使う名前空間だけを渡して張る
// （src/i18n/client-messages.ts）。Server Component の getTranslations は
// プロバイダを必要としないため、not-found.tsx とこのファイルはそのままで動く。
export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang={defaultLocale}>
      <body>
        <QueryProvider>{children}</QueryProvider>
        <ClientErrorBridge />
      </body>
    </html>
  );
}
