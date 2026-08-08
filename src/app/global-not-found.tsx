import type {Metadata} from 'next';

import {getTranslations} from 'next-intl/server';

import NotFoundContent from '@/components/not-found-content';
import {isRtlLocale} from '@/i18n/routing';
import {resolveRequestLocale} from '@/i18n/server-locale';

import './globals.css';

// notFound() が呼ばれたときの 404。Next はこの応答をルートレイアウトで包まない
// ため、<html> / <body> をここで出力する。この規約を使わないと、ロケールとして
// 無効な1セグメントのパス（/robots.txt、/favicon.ico、/wp-login.php 等）が
// lang / dir / globals.css を持たない Next 組み込みのエラーシェルで返る。
//
// ロケールはミドルウェアが付けたヘッダーから解決する。Accept-Language を自前で
// 解析すると q 値の扱いを誤るうえ、解析の try/catch が Next の
// DYNAMIC_SERVER_USAGE 制御フロー例外まで握りつぶしてしまう。
export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  const t = await getTranslations({locale, namespace: 'Metadata'});

  return {
    description: t('description'),
    title: t('title')
  };
}

export default async function GlobalNotFound() {
  const locale = await resolveRequestLocale();
  const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <body>
        <NotFoundContent />
      </body>
    </html>
  );
}
