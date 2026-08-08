import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {NextIntlClientProvider} from 'next-intl';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {getMessages, getTranslations, setRequestLocale} from 'next-intl/server';

import ClientErrorBridge from '@/components/client-error-bridge';
import QueryProvider from '@/components/query-provider';
import {PATHNAME_HEADER} from '@/i18n/middleware-routing';
import {isRtlLocale, locales, type Locale} from '@/i18n/routing';
import {resolveRequestLocale} from '@/i18n/server-locale';

import '../globals.css';

export function generateStaticParams(): Array<{locale: Locale}> {
  return locales.map((locale) => ({locale}));
}

// ロケールとして無効な値でこのセグメントに入ってきたリクエストを、判定済みの
// ロケールを付けたパスへ送り直す。/robots.txt や /wp-login.php のような1セグメントの
// パスは [locale] に一致してしまうため、この検証が無いとトップページが 200 で返る。
//
// notFound() は使わない。描画中に notFound() を投げると、その 404 は lang / dir /
// globals.css を持たない Next 組み込みのエラーシェルで返る（Next 16.2 で確認）。
// リダイレクト先はどのルートにも一致しないため、src/app/global-not-found.tsx が
// 404 として描画される。
//
// リダイレクトはミドルウェアではなくここで行う。ミドルウェアは静的ファイル配信より
// 先に動くため、そこでリダイレクトすると public/ 配下の実ファイルが届かなくなる。
// この時点まで来たということは、実ファイルは存在しなかったということ。
//
// 送り先には既定ロケールを固定しない。固定すると、素通しパスの 404 が
// 全利用者に日本語で返る（ミドルウェアが判定した値を捨てることになる）。
async function redirectInvalidLocale(): Promise<never> {
  const requestHeaders = await headers();
  const originalPathname = requestHeaders.get(PATHNAME_HEADER);

  // フォールバックしない。ヘッダーが無いのはミドルウェアが素通しの経路で
  // PATHNAME_HEADER を付け忘れたということで、パスを捏造して静かに誤った
  // リダイレクトを返すより、原因の分かる例外で落とす方がよい。
  if (originalPathname === null) {
    throw new Error(
      `${PATHNAME_HEADER} が無いまま [locale] セグメントに到達した。src/middleware.ts の passThrough() を確認すること。`
    );
  }

  redirect(`/${await resolveRequestLocale()}${originalPathname}`);
}

// タイトルの既定値と説明文を設定する（Issue #100）。
export async function generateMetadata({
  params
}: {
  params: Promise<{locale: string}>;
}): Promise<Metadata> {
  const {locale} = await params;

  if (!locales.includes(locale as Locale)) {
    return {};
  }

  const t = await getTranslations({locale, namespace: 'Metadata'});

  return {
    description: t('description'),
    title: t('title')
  };
}

// <html> はこのレイアウトが出力する。ロケールは URL のセグメントから読むので、
// リクエストヘッダーにも next-intl の内部状態にも依存しない。
//
// このレイアウトの外側で起きる 404（ロケールとして無効な1セグメント、
// ドット付きパス、/api/* 等）は src/app/global-not-found.tsx が描画する。
export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;

  if (!locales.includes(locale as Locale)) {
    await redirectInvalidLocale();
  }

  setRequestLocale(locale as Locale);
  const messages = await getMessages();
  const dir = isRtlLocale(locale) ? 'rtl' : 'ltr';

  // QueryProvider はロケール切替でアンマウントされるが、ブラウザ側の
  // QueryClient はモジュールスコープで使い回すため、キャッシュは失われない
  // （src/components/query-provider.tsx）。
  return (
    <html lang={locale} dir={dir}>
      <body>
        <QueryProvider>
          <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        </QueryProvider>
        <ClientErrorBridge />
      </body>
    </html>
  );
}
