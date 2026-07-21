import {redirect} from 'next/navigation';

import {defaultLocale} from '@/i18n/routing';

export default async function BoardInviteAliasPage({
  params,
  searchParams
}: {
  params: Promise<{shareToken: string}>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const {shareToken} = await params;
  const queryParams = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(queryParams)) {
    if (typeof value === 'string') {
      query.set(key, value);
    }
  }

  const suffix = query.toString();
  redirect(suffix ? `/${defaultLocale}/b/${shareToken}?${suffix}` : `/${defaultLocale}/b/${shareToken}`);
}
