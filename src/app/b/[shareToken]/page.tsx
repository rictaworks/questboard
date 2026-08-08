import {NextIntlClientProvider} from 'next-intl';

import BoardInvitePanel from '@/components/board-invite-panel';
import {clientMessages} from '@/i18n/client-messages';

export default async function BoardInvitePage({
  params
}: {
  params: Promise<{shareToken: string}>;
}) {
  const {shareToken} = await params;
  // BoardInvitePanel は BoardInvite と Auth、その中の BoardCanvasPanel は BoardCanvas を使う。
  const messages = await clientMessages(['Auth', 'BoardInvite', 'BoardCanvas']);

  return (
    <main className="home-shell">
      <NextIntlClientProvider messages={messages}>
        <BoardInvitePanel shareToken={shareToken} />
      </NextIntlClientProvider>
    </main>
  );
}
