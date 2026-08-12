const AUTH_ENDPOINT = "https://x.com/i/oauth2/authorize";

export const xAuthStorageKeys = {
  codeVerifier: "questboard.x.codeVerifier",
  returnTo: "questboard.x.returnTo",
  state: "questboard.x.state"
} as const;

export function readXAuthSettings() {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  const clientId = process.env.NEXT_PUBLIC_X_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_X_REDIRECT_URI;
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

  if (!backendUrl) {
    throw new Error("NEXT_PUBLIC_BACKEND_URL is required");
  }
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_X_CLIENT_ID is required");
  }
  if (!redirectUri) {
    throw new Error("NEXT_PUBLIC_X_REDIRECT_URI is required");
  }
  if (!recaptchaSiteKey) {
    throw new Error("NEXT_PUBLIC_RECAPTCHA_SITE_KEY is required");
  }

  return {
    backendUrl,
    clientId,
    redirectUri,
    recaptchaSiteKey
  };
}

export function createOAuthState(): string {
  return crypto.randomUUID();
}

export function createCodeVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function buildXAuthorizationUrl({
  clientId,
  codeChallenge,
  redirectUri,
  state
}: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
}): string {
  const searchParams = new URLSearchParams({
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "tweet.read users.read",
    state
  });

  return `${AUTH_ENDPOINT}?${searchParams.toString()}`;
}

export async function loadRecaptchaToken(siteKey: string, action: string): Promise<string> {
  await ensureRecaptchaScript(siteKey);
  const grecaptcha = window.grecaptcha;

  if (!grecaptcha) {
    throw new Error("reCAPTCHA is unavailable");
  }

  await new Promise<void>((resolve) => {
    grecaptcha.ready(() => resolve());
  });

  return grecaptcha.execute(siteKey, {action});
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function ensureRecaptchaScript(siteKey: string): Promise<void> {
  if (window.grecaptcha?.execute) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-questboard-recaptcha="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), {once: true});
      existing.addEventListener("error", () => reject(new Error("Failed to load reCAPTCHA")), {once: true});
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.dataset.questboardRecaptcha = "true";
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.addEventListener("load", () => resolve(), {once: true});
    script.addEventListener("error", () => reject(new Error("Failed to load reCAPTCHA")), {once: true});
    document.head.appendChild(script);
  });
}

declare global {
  interface Window {
    grecaptcha?: {
      execute(siteKey: string, options: {action: string}): Promise<string>;
      ready(callback: () => void): void;
    };
  }
}
