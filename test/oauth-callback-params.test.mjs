import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

// ---------------------------------------------------------------------------
// OAuth コールバックのクエリ解析。
//
// プロキシやリダイレクト連鎖は同じパラメータを重複させることがある
// （?code=a&code=a）。Next はそれを配列として渡す。3種類のパラメータは
// 性質が違うため、同じ解析器を使い回すと壊れる:
//
//   code / state  … 下流でトークン交換に使う。配列のまま流すと 502 になるが、
//                   捨てるとサインインが完全に止まる
//   error         … 失敗の理由コード。access_denied かどうかで文言が変わる
//   error_description … Google が書く自由文。潰すと切り分けができなくなる
// ---------------------------------------------------------------------------

const pagePath = 'src/app/auth/google/callback/page.tsx';
const reportPath = 'src/lib/oauth-callback-report.ts';

// 重複した説明の区切りは、連結する側（page.tsx）と分割して丸める側
// （oauth-callback-report.ts）で必ず同じでなければならない。食い違うと、
// 通報の丸めがエントリの境界を見失い、後ろの説明が先頭の値ごと切り捨てられる。
async function readSeparator() {
  const source = await readFile(path.join(root, reportPath), 'utf8');
  const matched = /export const DESCRIPTION_SEPARATOR = (['"][^'"]*['"])/.exec(source);

  assert.notEqual(matched, null, `${reportPath} が DESCRIPTION_SEPARATOR を公開していない`);

  return matched[1];
}

// page.tsx から解析関数だけを取り出す。JSX と next-intl の import を含むため、
// 関数宣言の位置で切り出してから transpile する。切り出しで落ちる import の値は
// 実物から読んで注入する（テスト用の別値を置くと食い違いを見逃す）。
async function loadParsers() {
  const source = await readFile(path.join(root, pagePath), 'utf8');
  const start = source.indexOf('function readParam');

  assert.notEqual(start, -1, 'page.tsx に readParam が無い');

  const end = source.indexOf('export default');
  assert.notEqual(end, -1, 'page.tsx に既定エクスポートが無い');

  const declarations = source.slice(start, end);
  const {outputText} = ts.transpileModule(
    `const DESCRIPTION_SEPARATOR = ${await readSeparator()};\n${declarations}\n`
      + 'module.exports = {readParam, readErrorParam, readDescriptionParam};',
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}
  );

  const moduleShim = {exports: {}};
  new Function('module', 'exports', outputText)(moduleShim, moduleShim.exports);
  return moduleShim.exports;
}

const {readParam, readErrorParam, readDescriptionParam} = await loadParsers();

test('説明の区切りは通報側と同じ定数を共有する', async () => {
  const source = await readFile(path.join(root, pagePath), 'utf8');

  assert.match(
    source,
    /import \{DESCRIPTION_SEPARATOR\} from ["']@\/lib\/oauth-callback-report["']/,
    'page.tsx が区切りを独自に定義している。通報側の分割と食い違うと後ろの説明が失われる'
  );
});

test('readParam は単一の値をそのまま返す', () => {
  assert.equal(readParam('abc'), 'abc');
  assert.equal(readParam(undefined), null);
});

// 重複を捨てるとサインインが完全に止まる。error 側は readErrorParam が
// 明示的に重複を許容しており、連鎖の存在は想定済み。致命的な方だけを
// 落とす理由が無い。
test('readParam は重複した値の先頭を採り、サインインを止めない', () => {
  assert.equal(readParam(['4/0AX4', '4/0AX4']), '4/0AX4');
  assert.equal(readParam(['S1', 'S2']), 'S1');
});

// 配列のまま流すと truthy なので欠落判定を素通りし、バックエンドのトークン
// 交換に配列が届いて 502 になる。文字列以外は必ず落とす。
test('readParam は文字列でない要素を落とす', () => {
  assert.equal(readParam([]), null);
  assert.equal(readParam(['', '  ']), null);
});

test('readErrorParam は access_denied を優先する', () => {
  assert.equal(readErrorParam(['invalid_request', 'access_denied']), 'access_denied');
  assert.equal(readErrorParam(' access_denied'), 'access_denied');
  assert.equal(readErrorParam(['', 'invalid_request']), 'invalid_request');
});

// error_description は自由文で、access_denied という語がその中に現れうる
// （"access_denied by administrator"）。error 用の解析器を通すと、
// リテラル access_denied に潰れるか先頭以外が捨てられ、invalid_client と
// redirect_uri_mismatch と admin_policy_enforced を切り分ける唯一の
// フィールドが失われる。
test('readDescriptionParam は本文を access_denied に潰さない', () => {
  assert.equal(
    readDescriptionParam('access_denied by administrator'),
    'access_denied by administrator'
  );
});

test('readDescriptionParam は重複した本文を捨てずに残す', () => {
  const parsed = readDescriptionParam([
    'access_denied by administrator',
    'Missing required parameter: client_id'
  ]);

  assert.match(parsed, /access_denied by administrator/);
  assert.match(parsed, /Missing required parameter: client_id/);
});

test('readDescriptionParam は値が無ければ null を返す', () => {
  assert.equal(readDescriptionParam(undefined), null);
  assert.equal(readDescriptionParam(['', '   ']), null);
});
