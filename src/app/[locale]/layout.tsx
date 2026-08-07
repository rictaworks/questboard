import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {NextIntlClientProvider} from 'next-intl';
import {notFound} from 'next/navigation';
import {getMessages, getTranslations, setRequestLocale} from 'next-intl/server';

import ClientErrorBridge from '@/components/client-error-bridge';
import QueryProvider from '@/components/query-provider';
import {locales, type Locale, isRtlLocale} from '@/i18n/routing';

import '../globals.css';

export function generateStaticParams(): Array<{locale: Locale}> {
  return locales.map((locale) => ({locale}));
}

// ルートの layout.tsx にもタイトルの既定値を置いているが、そちらはロケールを知らない。
// 説明文だけはロケールごとに変わるため、ここで上書きする（Issue #100）。
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

export default async function LocaleLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{locale: string}>;
}) {
  const {locale} = await params;

  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale as Locale);
  const messages = await getMessages();
  const dir = isRtlLocale(locale as Locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <QueryProvider>{children}</QueryProvider>
          <ClientErrorBridge />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
