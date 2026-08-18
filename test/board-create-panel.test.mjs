import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

// issue #194: 開発環境の初回アクセスでは、マウント直後の POST /dev/session が完了する前に
// 利用者（特に自動テスト）がボード作成を送信でき、Cookie未確立の POST /boards が401で
// 失敗する。作成リクエストの前に共有devセッションの確立完了を待つことを固定する。
test('board creation waits for the shared dev session before posting', async () => {
  const source = await readFile(path.join(root, 'src/components/board-create-panel.tsx'), 'utf8');

  const submitHandler = source.match(
    /async function handleSubmit\(event: FormEvent<HTMLFormElement>\) \{[\s\S]*?\n  \}/
  );
  assert.ok(submitHandler, 'could not locate handleSubmit in board-create-panel.tsx');

  const waitIndex = submitHandler[0].indexOf('await waitForDevSession(');
  const fetchIndex = submitHandler[0].indexOf('await fetch(');

  assert.notEqual(waitIndex, -1, 'POST /boards の前に waitForDevSession で devセッション確立を待っていない');
  assert.notEqual(fetchIndex, -1, 'could not locate the create fetch call in handleSubmit');
  assert.ok(
    waitIndex < fetchIndex,
    'waitForDevSession が fetch の後に置かれている。Cookie確立前に POST /boards が飛ぶレース（issue #194）が残る'
  );
});
