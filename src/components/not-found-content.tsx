import type {Route} from 'next';
import Link from 'next/link';
import {getLocale, getTranslations} from 'next-intl/server';

// 404 の本文は src/app/not-found.tsx と src/app/[locale]/not-found.tsx の両方から
// 使う。片方だけ直して見た目が食い違うのを防ぐため、ここに一本化する。
export default async function NotFoundContent() {
  const locale = await getLocale();
  const t = await getTranslations({locale, namespace: 'NotFound'});

  return (
    <main className="home-shell">
      <div className="not-found-card hero-card">
        <h1 className="home-title">{t('title')}</h1>
        <p className="not-found-description hero-copy">{t('description')}</p>
        <Link href={`/${locale}` as Route} className="button button-primary">
          {t('homeButton')}
        </Link>
      </div>
    </main>
  );
}
