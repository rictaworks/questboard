'use client';

import {useEffect} from 'react';

import {sanitizeClientErrorUrl} from '@/lib/sentry-sanitizer';
import {sentryEnabled} from '@/lib/sentry-config';


function sendClientError(payload: Record<string, unknown>) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) {
    return;
  }

  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      `${backendUrl}/client_errors`,
      new Blob([body], {type: 'application/json'})
    );
    if (sent) {
      return;
    }
  }

  void fetch(`${backendUrl}/client_errors`, {
    body,
    headers: {
      'Content-Type': 'application/json'
    },
    keepalive: true,
    method: 'POST',
    mode: 'cors'
  });
}

export default function ClientErrorBridge() {
  useEffect(() => {
    if (sentryEnabled()) {
      return;
    }

    const reportError = (event: ErrorEvent) => {
      sendClientError({
        column: event.colno,
        line: event.lineno,
        message: event.message,
        source: event.filename,
        stack: event.error instanceof Error ? event.error.stack : null,
        url: sanitizeClientErrorUrl(window.location.href),
        user_agent: navigator.userAgent
      });
    };

    const reportRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      sendClientError({
        message: reason.message,
        source: 'unhandledrejection',
        stack: reason.stack,
        url: sanitizeClientErrorUrl(window.location.href),
        user_agent: navigator.userAgent
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
