import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('sign out reloads the page so all session-driven panels refresh together', async () => {
  const source = await readFile(path.join(root, 'src/components/auth-panel.tsx'), 'utf8');

  assert.match(source, /queryClient\.removeQueries\(\{queryKey: QUEST_QUERY_ROOT_KEY\}\);/);
  assert.match(source, /window\.location\.reload\(\);/);
});

// isDev の分岐は見た目だけ認証済みに見せかけていて、実際のセッションCookieを張らないと
// ボード作成のような書き込み系が常に401になっていた（バックエンドの
// dev/session_controller.rb で本物のセッションを発行するよう修正した対）。
// UIが見た目上「認証済み」を表示し続けるのは変えない一方で、実際に
// establishDevSession を呼ぶことを退行防止として固定する。
test('development bypass establishes a real backend session instead of only faking local state', async () => {
  const source = await readFile(path.join(root, 'src/components/auth-panel.tsx'), 'utf8');

  assert.match(source, /import\s*\{establishDevSession\}\s*from\s*"@\/lib\/session-api";/);
  assert.match(source, /void establishDevSession\(t\("developmentSessionError"\)\)/);
});
