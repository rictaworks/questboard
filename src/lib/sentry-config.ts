export function sentryEnabled(
  env = process.env.NEXT_PUBLIC_ENV,
  dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
): boolean {
  return env === 'production' && Boolean(dsn?.trim());
}
