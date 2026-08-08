import createMiddleware from 'next-intl/middleware';

import {defaultLocale, locales} from '@/i18n/routing';

export default createMiddleware({
  defaultLocale,
  locales: [...locales]
});

// Next.js requires `matcher` entries to be static string literals (no computed
// values).
export const config = {
  matcher: [
    '/((?!api(?:/|$)|_next(?:/|$)|_vercel(?:/|$)|.*\\..*).*)'
  ]
};
