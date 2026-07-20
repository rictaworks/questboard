import createMiddleware from 'next-intl/middleware';

import {defaultLocale, locales} from '@/i18n/routing';

export default createMiddleware({
  defaultLocale,
  locales: [...locales]
});

export const config = {
  matcher: ['/', '/(ja|en|fr|zh|ru|es|ar)/:path*']
};
