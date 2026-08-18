import {isDevelopmentEnvironment} from "@/lib/environment";

// バックエンドURLの決定方法は本番と開発で異なる。
//
// 本番（Vercel + Railway）は両者が別ドメインの固定URLなので、
// NEXT_PUBLIC_BACKEND_URL をそのまま使えばよい。現在のoriginから動的に
// 導出する必要はないし、してはならない（Railway側のドメインを推測で
// 組み立てる方が事故りやすい）。
//
// 開発（Codespaces）は事情が異なる。.env の NEXT_PUBLIC_BACKEND_URL は
// コンテナ内から直接見るとき用に http://localhost:3001 を指しているが、
// 開発者が実ブラウザでCodespacesの転送URL
// （<codespace-name>-<port>.<forwarding-domain>）を開いた場合、
// localhost はブラウザを動かしている手元のマシンを指してしまい、
// バックエンドに繋がらない。この場合は現在のoriginのポート部分だけを
// バックエンド用に置き換えた転送URLを組み立てる。
//
// 転送URLのパターンに一致しない場合（コンテナ内直アクセス、素の
// localhost、SSRなど）は、この関数の管轄外として configuredUrl を
// そのまま返す。必須チェック（未設定時にどう扱うか）は呼び出し側の
// 責務であり、ここでは判定しない。
export function resolveBackendUrl(configuredUrl: string | undefined): string | undefined {
  if (!configuredUrl) {
    return undefined;
  }

  if (!isDevelopmentEnvironment()) {
    return configuredUrl;
  }

  return resolveDevelopmentBackendUrl(configuredUrl);
}

function resolveDevelopmentBackendUrl(configuredUrl: string): string {
  if (typeof window === "undefined") {
    return configuredUrl;
  }

  const forwardingDomain = process.env.NEXT_PUBLIC_CODESPACES_FORWARDING_DOMAIN;
  if (!forwardingDomain) {
    return configuredUrl;
  }

  const {hostname, protocol} = window.location;
  const suffix = `.${forwardingDomain}`;
  if (!hostname.endsWith(suffix)) {
    return configuredUrl;
  }

  const forwardedPrefix = hostname.slice(0, hostname.length - suffix.length);
  const lastDashIndex = forwardedPrefix.lastIndexOf("-");
  if (lastDashIndex === -1) {
    return configuredUrl;
  }

  const codespaceName = forwardedPrefix.slice(0, lastDashIndex);
  const backendPort = new URL(configuredUrl).port;
  if (!backendPort) {
    return configuredUrl;
  }

  return `${protocol}//${codespaceName}-${backendPort}.${forwardingDomain}`;
}
