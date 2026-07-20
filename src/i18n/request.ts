import {getRequestConfig} from 'next-intl/server';

import {defaultLocale, locales} from './routing';

export default getRequestConfig(async ({requestLocale}) => {
  const requestedLocale = await requestLocale;
  const locale = locales.includes(requestedLocale as (typeof locales)[number])
    ? (requestedLocale as (typeof locales)[number])
    : defaultLocale;

  const messages = (await import(`../messages/${locale}.json`)).default as Record<string, unknown>;

  return {
    locale,
    messages
  };
});
