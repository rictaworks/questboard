import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {NextIntlClientProvider} from 'next-intl';
import {notFound} from 'next/navigation';
import {getMessages, getTranslations, setRequestLocale} from 'next-intl/server';

import {locales, type Locale} from '@/i18n/routing';

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

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
