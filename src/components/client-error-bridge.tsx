'use client';

import {useEffect} from 'react';

import {reportClientError} from '@/lib/client-error-report';
import {sentryEnabled} from '@/lib/sentry-config';

export default function ClientErrorBridge() {
  useEffect(() => {
    if (sentryEnabled()) {
      return;
    }

    // 送信結果はここでは使わない。購読しているのは window の error と
    // unhandledrejection なので、失敗を扱おうとすると再通報のループに近づく。
    const reportError = (event: ErrorEvent) => {
      void reportClientError({
        column: event.colno,
        line: event.lineno,
        message: event.message,
        source: event.filename,
        stack: event.error instanceof Error ? event.error.stack : null
      });
    };

    const reportRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      void reportClientError({
        message: reason.message,
        source: 'unhandledrejection',
        stack: reason.stack
      });
    };

    window.addEventListener('error', reportError);
    window.addEventListener('unhandledrejection', reportRejection);

    return () => {
      window.removeEventListener('error', reportError);
      window.removeEventListener('unhandledrejection', reportRejection);
    };
  }, []);

  return null;
}
