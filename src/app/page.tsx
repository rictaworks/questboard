import {NextIntlClientProvider} from 'next-intl';
import {getTranslations} from 'next-intl/server';
import Link from 'next/link';

import AuthPanel from '@/components/auth-panel';
import BoardCreatePanel from '@/components/board-create-panel';
import BoardListPanel from '@/components/board-list-panel';
import {clientMessages} from '@/i18n/client-messages';

// このページは製品紹介の LP ではなく、アプリの入口（ログインし、ボードを作る場所）である。
// 製品紹介は rictaworks.jp 側の役割なので、キャッチコピーも開発用の雛形説明もここには置かない
// （Issue #99）。h1 は製品名のみとし、見出し階層の最上位を画面の機能に譲る。
export default async function HomePage() {
  const t = await getTranslations('Home');
  // AuthPanel は Auth、BoardListPanel は BoardList、BoardCreatePanel は BoardCreate と Auth を使う。
  const messages = await clientMessages(['Auth', 'BoardCreate', 'BoardList']);

  return (
    <main className="home-shell">
      <h1 className="home-title">{t('title')}</h1>
      {/* 未ログインでも読める使い方ページへの導線（issue #209）。
          製品紹介を置かない方針（Issue #99）は維持し、リンク1行に留める */}
      <p className="home-guide-link">
        <Link href="/guide">{t('guideLink')}</Link>
      </p>

      <NextIntlClientProvider messages={messages}>
        <section className="auth-section" aria-labelledby="auth-heading">
          <h2 id="auth-heading">{t('authSectionTitle')}</h2>
          <AuthPanel />
        </section>

        <div className="board-section">
          <BoardListPanel />
          <BoardCreatePanel />
        </div>
      </NextIntlClientProvider>
    </main>
  );
}
