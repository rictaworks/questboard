import type {Metadata} from 'next';
import type {ReactNode} from 'react';

import {NextIntlClientProvider} from 'next-intl';
import {notFound} from 'next/navigation';
import {getMessages, getTranslations, setRequestLocale} from 'next-intl/server';

import {locales, type Locale} from '@/i18n/routing';

export function generateStaticParams(): Array<{locale: Locale}> {
  return locales.map((locale) => ({locale}));
}

// タイトルの既定値と説明文を設定する（Issue #100）。
// ルートレイアウトの generateMetadata もヘッダー由来のロケールで同じ値を返すが、
// URL のロケールとヘッダーが食い違う場合はこちらの URL 由来の値が優先される。
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

// <html> / <body> は src/app/layout.tsx が出力する。ここで二重に出さないこと。
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

  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
