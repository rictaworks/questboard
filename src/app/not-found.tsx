import {getLocale, getTranslations} from 'next-intl/server';
import Link from 'next/link';
import {isRtlLocale, type Locale} from '@/i18n/routing';
import type {Route} from 'next';

export default async function GlobalNotFound() {
  const locale = await getLocale();
  const dir = isRtlLocale(locale as Locale) ? 'rtl' : 'ltr';
  const t = await getTranslations({locale, namespace: 'NotFound'});
  const tMeta = await getTranslations({locale, namespace: 'Metadata'});

  return (
    <html lang={locale} dir={dir}>
      <head>
        <title>{tMeta('title')}</title>
      </head>
      <body>
        <main className="home-shell">
          <div className="hero-card" style={{ textAlign: 'center', margin: 'var(--space-12) auto', maxWidth: '36rem' }}>
            <h1 className="home-title">{t('title')}</h1>
            <p className="hero-copy" style={{ margin: 'var(--space-4) auto var(--space-8)' }}>{t('description')}</p>
            <Link href={`/${locale}` as Route} className="button button-primary">
              {t('homeButton')}
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
