export const locales = ['ja', 'en', 'fr', 'zh', 'ru', 'es', 'ar'] as const;
export const defaultLocale = 'ja';
export type Locale = (typeof locales)[number];

export const rtlLocales: readonly Locale[] = ['ar'];

// 呼び出し側の locale は useLocale() / getLocale() 由来の string になることが多い。
// 引数を Locale に絞ると全呼び出し箇所でキャストが必要になり、`as any` で型検査を
// 捨てる書き方を誘発するため、string を受けてこの関数の中で判定する。
export function isRtlLocale(locale: string): boolean {
  return rtlLocales.includes(locale as Locale);
}
