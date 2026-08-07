export const locales = ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar'] as const;
export const defaultLocale = 'ja';
export type Locale = (typeof locales)[number];

export const rtlLocales: readonly Locale[] = ['ar'];

export function isRtlLocale(locale: Locale): boolean {
  return rtlLocales.includes(locale);
}
