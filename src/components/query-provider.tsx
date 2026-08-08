'use client';

import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import {useState, type ReactNode} from 'react';

import {createQueryClient} from '@/lib/query-client';

// ブラウザ側の QueryClient。モジュールスコープに置くのはブラウザ用の1個だけで、
// サーバー側は必ずレンダリングごとに新しいインスタンスを作る。
//
// サーバーでモジュールスコープのインスタンスを共有すると、同一 Node.js プロセス上の
// 並行リクエストが1つのキャッシュを見て、あるユーザーのクエスト状態が別ユーザーの
// HTML に混入する（request bleed）。ブラウザでは1タブ＝1プロセスなのでこの危険はない。
let browserQueryClient: QueryClient | undefined;

function resolveQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return createQueryClient();
  }

  browserQueryClient ??= createQueryClient();

  return browserQueryClient;
}

// このプロバイダは src/app/[locale]/layout.tsx（ロケールセグメントの内側）に置く。
// App Router はレイアウトを動的セグメントの値でキー付けするため、/ja → /en の
// ロケール切替でこのコンポーネントはアンマウント・再マウントされる。
// 再マウントで useState の初期化が走り直しても、ブラウザでは上の
// browserQueryClient を返すため、取得済みのボード・クエストのキャッシュは残る。
export default function QueryProvider({children}: {children: ReactNode}) {
  const [queryClient] = useState(resolveQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
