import type {Route} from 'next';
import {getLocale, getTranslations} from 'next-intl/server';
import Link from 'next/link';

export default async function NotFound() {
  const t = await getTranslations('NotFound');
  const locale = await getLocale();

  return (
    <main className="home-shell">
      <div className="hero-card" style={{ textAlign: 'center', margin: 'var(--space-12) auto', maxWidth: '36rem' }}>
        <h1 className="home-title">
          {t('title')}
        </h1>
        <p className="hero-copy" style={{ margin: 'var(--space-4) auto var(--space-8)' }}>
          {t('description')}
        </p>
        <Link href={`/${locale}` as Route} className="button button-primary">
          {t('homeButton')}
        </Link>
      </div>
    </main>
  );
}
