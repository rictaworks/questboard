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
