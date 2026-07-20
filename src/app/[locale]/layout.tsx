import type {ReactNode} from 'react';

import {notFound} from 'next/navigation';
import {setRequestLocale} from 'next-intl/server';

import {locales, type Locale} from '@/i18n/routing';

export function generateStaticParams(): Array<{locale: Locale}> {
  return locales.map((locale) => ({locale}));
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

  return children;
}
