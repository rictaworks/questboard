import type {ReactNode} from 'react';

import ClientErrorBridge from '@/components/client-error-bridge';
import QueryProvider from '@/components/query-provider';
import {defaultLocale} from '@/i18n/routing';

import './globals.css';

// QueryProvider は [locale]/layout.tsx ではなくルートに置く。
// src/app/auth/google/callback と src/app/b/[shareToken] は [locale] セグメントの
// 外にも存在するため、ルートで1つ張る方がプロバイダを二重管理せずに済み、
// ロケール切替でキャッシュが捨てられることもない。
// このレイアウトは Server Component のまま、children をクライアント境界越しに
// 渡すだけなので、配下がクライアントコンポーネント化するコストは発生しない。
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
