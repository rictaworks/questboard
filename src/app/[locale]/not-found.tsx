'use client';

import type {Route} from 'next';
import {useTranslations} from 'next-intl';
import Link from 'next/link';

export default function NotFound() {
  const t = useTranslations('NotFound');

  return (
    <main className="home-shell">
      <div className="hero-card" style={{ padding: 'var(--space-8)', textAlign: 'center', margin: 'var(--space-12) auto', maxWidth: '36rem' }}>
        <h1 className="home-title" style={{ fontSize: 'var(--font-size-4xl)', marginBottom: 'var(--space-4)' }}>
          {t('title')}
        </h1>
        <p style={{ color: 'rgba(247, 244, 255, 0.6)', marginBottom: 'var(--space-8)', lineHeight: '1.6' }}>
          {t('description')}
        </p>
        <Link href={"/" as Route} className="button button-primary">
          {t('homeButton')}
        </Link>
      </div>
    </main>
  );
}
