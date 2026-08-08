import Link from 'next/link';
import {getTranslations} from 'next-intl/server';

import {resolveRequestLocale} from '@/i18n/server-locale';

// 404 の本文。src/app/global-not-found.tsx から使う。将来 [locale] 配下に
// not-found 境界を足すときも、本文はここに一本化して見た目を揃えること。
export default async function NotFoundContent() {
  // ロケールはリテラル型の Locale で受け取る。string にすると href が
  // typedRoutes の検査を通らず、型キャストで押し通す形になり、「ホームに戻る」の
  // 行き先が壊れてもビルドで気付けなくなる。
  const locale = await resolveRequestLocale();
  const t = await getTranslations({locale, namespace: 'NotFound'});

  return (
    <main className="home-shell">
      <div className="not-found-card hero-card">
        <h1 className="home-title">{t('title')}</h1>
        <p className="not-found-description hero-copy">{t('description')}</p>
        <Link href={`/${locale}`} className="button button-primary">
          {t('homeButton')}
        </Link>
      </div>
    </main>
  );
}
