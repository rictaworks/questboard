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
// UIが見た目上「認証済み」を表示し続けるのは変えない一方で、実際にセッションを
// 確立することを退行防止として固定する。establishDevSession の直接呼び出しではなく
// 共有Promise版の ensureDevSession を使うこと（issue #194: 直接呼ぶと POST /dev/session が
// パネルごとに複数飛び、他パネルが同じ確立完了を待ち合わせられない）。
test('development bypass establishes the shared real backend session instead of only faking local state', async () => {
  const source = await readFile(path.join(root, 'src/components/auth-panel.tsx'), 'utf8');

  assert.match(source, /import\s*\{ensureDevSession\}\s*from\s*"@\/lib\/session-api";/);
  assert.match(source, /void ensureDevSession\(t\("developmentSessionError"\)\)/);
});
