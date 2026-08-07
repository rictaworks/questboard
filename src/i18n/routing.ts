export const locales = ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar'] as const;
export const defaultLocale = 'ja';
export const rtlLocales: Locale[] = ['ar'];

export type Locale = (typeof locales)[number];

export function isRtlLocale(locale: Locale): boolean {
  return rtlLocales.includes(locale);
}

