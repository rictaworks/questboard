'use client';

import * as Sentry from '@sentry/nextjs';
import {useEffect} from 'react';

import {sentryEnabled} from '@/lib/sentry-config';

function initSentry() {
  if (!sentryEnabled()) {
    return false;
  }

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_ENV,
    enabled: true
  });
  return true;
}

function sanitizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/(\/b\/)[^/]+/, '$1[redacted]');
    return url.toString();
  } catch {
    return '';
  }
}

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
    if (initSentry()) {
      return;
    }

    const reportError = (event: ErrorEvent) => {
      sendClientError({
        column: event.colno,
        line: event.lineno,
        message: event.message,
        source: event.filename,
        stack: event.error instanceof Error ? event.error.stack : null,
        url: sanitizeUrl(window.location.href),
        user_agent: navigator.userAgent
      });
    };

    const reportRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      sendClientError({
        message: reason.message,
        source: 'unhandledrejection',
        stack: reason.stack,
        url: sanitizeUrl(window.location.href),
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
