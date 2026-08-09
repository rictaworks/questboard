import Link from 'next/link';
import {getTranslations} from 'next-intl/server';

// どのルートにも一致しない URL の 404。
//
// このファイルが無いと Next 組み込みの 404 が使われ、日本語のみの製品なのに
// "404: This page could not be found." という英語が、サイトのスタイルも当たらない
// 白背景で返る。src/app/layout.tsx の中に描画されるため、lang と globals.css は
// このファイル側で用意する必要はない。
export default async function NotFound() {
  const t = await getTranslations('NotFound');

  return (
    <main className="home-shell">
      <div className="not-found-card hero-card">
        <h1 className="home-title">{t('title')}</h1>
        <p className="not-found-description hero-copy">{t('description')}</p>
        <Link href="/" className="button button-primary">
          {t('homeButton')}
        </Link>
      </div>
    </main>
  );
}
