import BoardInvitePanel from '@/components/board-invite-panel';

export default async function BoardInvitePage({
  params
}: {
  params: Promise<{locale: string; shareToken: string}>;
}) {
  const {shareToken} = await params;

  return (
    <main className="home-shell">
      <BoardInvitePanel shareToken={shareToken} />
    </main>
  );
}
