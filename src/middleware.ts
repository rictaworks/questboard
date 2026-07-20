import createMiddleware from 'next-intl/middleware';

import {defaultLocale, locales} from '@/i18n/routing';

export default createMiddleware({
  defaultLocale,
  locales: [...locales]
});

// Next.js requires `matcher` entries to be static string literals (no computed
// values), so this list cannot be derived from `locales` at build time.
// `test/scaffold.test.mjs` asserts these two lists stay in sync.
export const config = {
  matcher: ['/', '/(ja|en|fr|zh|ru|es|ar)/:path*']
};
