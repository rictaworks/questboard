import {headers} from 'next/headers';
import {getTranslations} from 'next-intl/server';
import Link from 'next/link';
import {isRtlLocale, locales, defaultLocale, type Locale} from '@/i18n/routing';
import type {Route} from 'next';
import './globals.css';

async function getBrowserLocale(): Promise<Locale> {
  try {
    const headersList = await headers();
    const acceptLanguage = headersList.get('accept-language');
    if (!acceptLanguage) {
      return defaultLocale;
    }
    const preferredLocales = acceptLanguage
      .split(',')
      .map((lang) => lang.split(';')[0].trim().split('-')[0].toLowerCase());

    for (const pref of preferredLocales) {
      if (locales.includes(pref as Locale)) {
        return pref as Locale;
      }
    }
  } catch {
    // Safe fallback to default locale in case headers cannot be read
  }
  return defaultLocale;
}

export default async function GlobalNotFound() {
  const locale = await getBrowserLocale();
  const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';
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
