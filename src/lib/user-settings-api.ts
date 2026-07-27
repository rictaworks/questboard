import type {FeedbackIntensityCode} from '@/lib/feedback-director';

export interface UserSettingsSnapshot {
  intensity: FeedbackIntensityCode;
}

export interface UserSettingsApiOptions {
  backendUrl: string;
  fetchImpl?: typeof fetch;
}

export class UserSettingsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UserSettingsApiError';
    this.status = status;
  }
}

const INTENSITY_CODES: readonly FeedbackIntensityCode[] = ['full', 'subtle', 'off'];

function resolveFetch(options: UserSettingsApiOptions): typeof fetch {
  return options.fetchImpl ?? fetch;
}

function validateSnapshot(payload: unknown, url: string, status: number): UserSettingsSnapshot {
  if (typeof payload !== 'object' || payload == null) {
    throw new UserSettingsApiError(`User settings API returned a non-object body: ${url}`, status);
  }

  const intensity = (payload as {intensity?: unknown}).intensity;
  if (typeof intensity !== 'string' || !INTENSITY_CODES.includes(intensity as FeedbackIntensityCode)) {
    throw new UserSettingsApiError(`User settings API returned an invalid intensity: ${url}`, status);
  }

  return {intensity: intensity as FeedbackIntensityCode};
}

async function readSnapshot(response: Response, url: string): Promise<UserSettingsSnapshot> {
  if (!response.ok) {
    throw new UserSettingsApiError(`User settings API request failed: ${url}`, response.status);
  }

  return validateSnapshot(await response.json(), url, response.status);
}

export async function fetchUserSettings(
  options: UserSettingsApiOptions,
  signal?: AbortSignal
): Promise<UserSettingsSnapshot> {
  const url = `${options.backendUrl}/user_settings`;
  const response = await resolveFetch(options)(url, {
    credentials: 'include',
    signal
  });

  return readSnapshot(response, url);
}

export async function updateUserSettings(
  options: UserSettingsApiOptions,
  intensity: FeedbackIntensityCode
): Promise<UserSettingsSnapshot> {
  const url = `${options.backendUrl}/user_settings`;
  const response = await resolveFetch(options)(url, {
    body: JSON.stringify({intensity}),
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    method: 'PATCH'
  });

  return readSnapshot(response, url);
}
