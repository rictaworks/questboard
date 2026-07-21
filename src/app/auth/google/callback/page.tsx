import {redirect} from "next/navigation";

import {defaultLocale} from "@/i18n/routing";

export default async function GoogleCallbackAliasPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      query.set(key, value);
    }
  }

  const suffix = query.toString();
  redirect(suffix ? `/${defaultLocale}/auth/google/callback?${suffix}` : `/${defaultLocale}/auth/google/callback`);
}
