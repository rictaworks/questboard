export const runtimeEnvironment = process.env.NEXT_PUBLIC_ENV ?? 'production';

export function isDevelopmentEnvironment(): boolean {
  return runtimeEnvironment === 'development';
}
