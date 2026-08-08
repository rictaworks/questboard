'use client';

import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import {useState, type ReactNode} from 'react';

import {createQueryClient} from '@/lib/query-client';

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // サーバーサイド（SSR）ではリクエストごとに毎回新しい QueryClient を作成して返す。
    // これにより、同一Node.jsプロセス上の並行リクエスト間でキャッシュが共有される
    // セキュリティ上のリスク（request bleed）を防ぐ。
    return createQueryClient();
  } else {
    // クライアントサイド（ブラウザ）では、一度作成したインスタンスを再利用する。
    // これにより、言語切り替え等で QueryProvider が再マウントされた場合でも、
    // キャッシュされたクエリデータが消失しないようにする。
    if (!browserQueryClient) {
      browserQueryClient = createQueryClient();
    }
    return browserQueryClient;
  }
}

export default function QueryProvider({children}: {children: ReactNode}) {
  const [queryClient] = useState(getQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
