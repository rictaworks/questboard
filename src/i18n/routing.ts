export const locales = ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar'] as const;
export const defaultLocale = 'ja';

export type Locale = (typeof locales)[number];
