import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

// issue #209 / #210: 使い方・更新履歴の静的ページ。Playwright 環境が無いローカルでも
// 走る退行防止として、ソーステキストレベルの検査をここに置く（描画の実検証は
// legal-page.test.mjs 側の Playwright テストが担う）。

test('guide and updates pages exist and render plain static content (issues #209/#210)', async () => {
  const guide = await readFile(path.join(root, 'src/app/guide/page.tsx'), 'utf8');
  const updates = await readFile(path.join(root, 'src/app/updates/page.tsx'), 'utf8');

  // 認証・クライアント状態に依存しないサーバーコンポーネントであること
  for (const [name, source] of [['guide', guide], ['updates', updates]]) {
    assert.doesNotMatch(source, /'use client'|"use client"/, `${name} がクライアントコンポーネントになっている`);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML/, `${name} が HTML 挿入を使っている（XSS リスク）`);
    assert.match(source, /getTranslations/, `${name} の文言が ja.json 経由になっていない`);
  }

  // 更新履歴に v1.0.0 の初版エントリと追記手順の説明があること（#210 受け入れ要件）
  assert.match(updates, /v1-0-0/, '更新履歴に v1.0.0 のエントリが無い');
  assert.match(updates, /追記手順/, '次リリース時の追記手順が明文化されていない');
});

test('footer links to guide and updates pages', async () => {
  const footer = await readFile(path.join(root, 'src/components/site-footer.tsx'), 'utf8');

  assert.match(footer, /href="\/guide"/, 'フッターに使い方ページへのリンクが無い');
  assert.match(footer, /href="\/updates"/, 'フッターに更新履歴ページへのリンクが無い');
});

test('ja.json provides Guide and Updates copy', async () => {
  const messages = JSON.parse(await readFile(path.join(root, 'src/messages/ja.json'), 'utf8'));

  assert.ok(messages.Guide, 'ja.json に Guide セクションが無い');
  assert.ok(messages.Updates, 'ja.json に Updates セクションが無い');
  assert.ok(messages.Footer.guide, 'Footer.guide の文言が無い');
  assert.ok(messages.Footer.updates, 'Footer.updates の文言が無い');
  assert.ok(messages.Home.guideLink, 'Home.guideLink の文言が無い');

  // v1.0.0 の項目が7件（今回リリースの7 Issue 分）揃っていること
  const v100Items = Object.keys(messages.Updates).filter((key) => /^v100Item\d+$/.test(key));
  assert.equal(v100Items.length, 7, 'Updates の v1.0.0 項目数が想定と違う');
});
