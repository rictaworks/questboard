// セッション応答の項目を、画面側が手で書き写していないことを固定する。
//
// #253 で拒否画面に照会用ID（inquiryId）を足したとき、画面側が応答の項目を
// 手で列挙していたため、バックエンドが返しているのに画面へ届かなかった。
// 型は省略可能な項目なので、書き写し漏れをコンパイラが検出できない。
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const PANELS = [
  'src/components/board-create-panel.tsx',
  'src/components/board-invite-panel.tsx'
];

test('セッションを描画するパネルは toSessionUser で変換する', () => {
  for (const path of PANELS) {
    const source = readFileSync(path, 'utf8');

    assert.match(
      source,
      /toSessionUser\(/,
      `${path} が toSessionUser を使っていない`
    );
    assert.doesNotMatch(
      source,
      /displayName:\s*payload\.user\?\./,
      `${path} が応答の項目を手で書き写している`
    );
    assert.doesNotMatch(
      source,
      /planCode:\s*payload\.user\?\./,
      `${path} が応答の項目を手で書き写している`
    );
  }
});

test('拒否画面には照会用IDが渡る', () => {
  for (const path of PANELS) {
    const source = readFileSync(path, 'utf8');
    if (!source.includes('PlanUnavailablePanel')) {
      continue;
    }

    assert.match(
      source,
      /inquiryId=\{sessionState\?\.inquiryId \?\? null\}/,
      `${path} が PlanUnavailablePanel へ照会用IDを渡していない`
    );
  }
});
