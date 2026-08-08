'use client';

import {QueryClientProvider} from '@tanstack/react-query';
import {useState, type ReactNode} from 'react';

import {createQueryClient} from '@/lib/query-client';

// QueryClient は必ずコンポーネント内で生成する。モジュールスコープで生成すると、
// SSR時に同一Node.jsプロセス上の並行リクエストが1つのキャッシュを共有し、
// あるユーザーのクエスト状態が別ユーザーのHTMLに混入しうる（request bleed）。
// useState の遅延初期化により、ブラウザではタブごとに1個、
// サーバーではレンダリングごとに1個のインスタンスに固定される。
// このプロバイダは src/app/layout.tsx（ロケールセグメントの外側）に置くため、
// ロケール切替で再マウントされずキャッシュも維持される。
export default function QueryProvider({children}: {children: ReactNode}) {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
