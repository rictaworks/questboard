import {redirect} from 'next/navigation';
import {getLocale} from 'next-intl/server';

export default async function GlobalNotFound() {
  const locale = await getLocale();
  redirect(`/${locale}/_not-found`);
}
