import * as Sentry from '@sentry/nextjs';

import {sanitizeSentryEvent} from '@/lib/sentry-sanitizer';

import {sentryEnabled} from './sentry-config';

export function initSentryClient() {
  if (!sentryEnabled()) {
    return false;
  }

  Sentry.init({
    beforeSend: (event: any) => sanitizeSentryEvent(event as Record<string, unknown>) as any,
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enabled: true,
    environment: process.env.NEXT_PUBLIC_ENV
  });

  return true;
}
