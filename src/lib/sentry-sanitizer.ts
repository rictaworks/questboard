const SHARE_TOKEN_PATH = /\/(b|boards)\/[^/?#]+/g;

function redactShareTokens(value: string): string {
  return value.replace(SHARE_TOKEN_PATH, '/$1/[redacted]');
}

function sanitizeUrlLike(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    url.pathname = redactShareTokens(url.pathname);
    return url.toString();
  } catch {
    return redactShareTokens(value.split(/[?#]/, 2)[0] ?? '');
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeUrlLike(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {...(value as Record<string, unknown>)};
  for (const key of ['url', 'message', 'transaction'] as const) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeUrlLike(sanitized[key] as string);
    }
  }

  if ('data' in sanitized) {
    sanitized.data = sanitizeValue(sanitized.data);
  }

  return sanitized;
}

export function sanitizeClientErrorUrl(value: string): string {
  return sanitizeUrlLike(value);
}

export function sanitizeSentryEvent(event: Record<string, unknown>): Record<string, unknown> {
  const sanitized = {...event};

  if (typeof sanitized.request === 'object' && sanitized.request) {
    sanitized.request = sanitizeValue(sanitized.request) as Record<string, unknown>;
  }

  if (typeof sanitized.transaction === 'string') {
    sanitized.transaction = sanitizeUrlLike(sanitized.transaction);
  }

  if (Array.isArray(sanitized.breadcrumbs)) {
    sanitized.breadcrumbs = sanitized.breadcrumbs.map((breadcrumb) => sanitizeValue(breadcrumb));
  }

  return sanitized;
}
