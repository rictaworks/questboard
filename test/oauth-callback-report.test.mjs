import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

// ---------------------------------------------------------------------------
// OAuth コールバックの「何を通報するか」の判断。
//
// この判断は3つの相反する要求の交点にある。
//   1. 画面に出せない失敗の原因（client_id の誤り / redirect_uri_mismatch /
//      管理ポリシー遮断）を運用側が切り分けられること
//   2. 誰でも叩ける公開 GET なので、攻撃者が書いた文章をログに流し込めないこと
//   3. POST /client_errors は送信元 IP あたり毎分10件で頭打ちなので、
//      被害者の枠を攻撃者や自分自身のリロードで使い切らせないこと
//
// React の effect に埋めるとブラウザ無しでは検証できないため、判断だけを
// 純粋関数に切り出してここで固定する。
// ---------------------------------------------------------------------------

async function loadModule(relativePath) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, () => {
    throw new Error('この関数は他モジュールに依存してはならない');
  });
  return moduleShim.exports;
}

const {
  buildCallbackReport,
  deliverCallbackReportOnce,
  DESCRIPTION_SEPARATOR
} = await loadModule('src/lib/oauth-callback-report.ts');

const baseInput = {
  embedded: false,
  error: null,
  errorDescription: null,
  missingParamKey: null,
  providerErrorKey: null,
  state: null,
  storedState: null
};

test('失敗していないコールバックは通報しない', () => {
  assert.equal(buildCallbackReport({...baseInput}), null);
});

// state が一致していれば、自分が始めた認証の戻りだと確かめられる。
// 切り分けに要る生の値はこのときだけ載せる。
test('state が一致するプロバイダエラーは生の値を載せて通報する', () => {
  const report = buildCallbackReport({
    ...baseInput,
    error: 'admin_policy_enforced',
    errorDescription: 'Blocked by administrator',
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });

  assert.notEqual(report, null);
  assert.match(report.message, /admin_policy_enforced/);
  assert.match(report.message, /Blocked by administrator/);
});

// 一致しない場合でも黙ってはいけない。sessionStorage はタブ単位なので、
// 別タブで開始した・クラッシュから復元した・Google が state を落としたという、
// まさに切り分けが要る場面ほどここに落ちる。
// ただしクエリ由来の値は載せない。載せると誰でもログへ好きな文章を書ける。
test('state が一致しないプロバイダエラーは理由コードだけを通報する', () => {
  const report = buildCallbackReport({
    ...baseInput,
    error: 'sagi-no-annai-desu-0120-000-000',
    errorDescription: '攻撃者が書いた文章',
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S2'
  });

  assert.notEqual(report, null);
  assert.doesNotMatch(report.message, /sagi-no-annai-desu/);
  assert.doesNotMatch(report.message, /攻撃者/);
  assert.match(report.message, /provider-error/);
  assert.match(report.message, /state-unverified/);
});

test('state が届かなかったプロバイダエラーも理由コードだけを通報する', () => {
  const report = buildCallbackReport({
    ...baseInput,
    error: 'access_denied',
    providerErrorKey: 'callbackDenied',
    state: null,
    storedState: 'S1'
  });

  assert.notEqual(report, null);
  assert.doesNotMatch(report.message, /access_denied/);
  assert.match(report.message, /state-unverified/);
});

// code は届いたのに state だけ落ちた場合。画面には専用の文言を出すが、
// 運用側には「state が落ちる経路がある」という事実が届く必要がある。
// これが無いと、利用者の「ログインできない」に対して調べる手がかりが残らない。
test('state だけが欠けたコールバックを通報する', () => {
  const report = buildCallbackReport({
    ...baseInput,
    missingParamKey: 'callbackMissingState',
    storedState: 'S1'
  });

  assert.notEqual(report, null);
  assert.match(report.message, /missing-state/);
});

test('code が欠けたコールバックを通報する', () => {
  const report = buildCallbackReport({
    ...baseInput,
    missingParamKey: 'callbackMissingCode',
    storedState: 'S1'
  });

  assert.notEqual(report, null);
  assert.match(report.message, /missing-code/);
});

// このタブで認証を始めた証拠が無いなら送らない。
//
// iframe を塞いでも、攻撃ページはポップアップを1枚開いて location を書き換え続け
// られる。トップレベル文書のままなので埋め込み判定では止まらず、state を変えれば
// 印も変わるため、被害者の IP から毎分10件の枠をいくらでも消費させられる。
// 自分が保存した state が残っていることを、送ってよいことの条件にする。
test('認証を始めた証拠が無いコールバックからは通報しない', () => {
  const providerError = buildCallbackReport({
    ...baseInput,
    error: 'x',
    providerErrorKey: 'callbackProviderError',
    state: '1',
    storedState: null
  });
  const missingCode = buildCallbackReport({
    ...baseInput,
    missingParamKey: 'callbackMissingCode',
    storedState: null
  });

  assert.equal(providerError, null);
  assert.equal(missingCode, null);
});

// 印がクエリ由来の値で変わると、攻撃者は state を変えるだけで何度でも送れる。
test('確かめられないコールバックの印はクエリ由来の値で変わらない', () => {
  const markers = ['1', '2', '3'].map((state) => buildCallbackReport({
    ...baseInput,
    error: `error-${state}`,
    providerErrorKey: 'callbackProviderError',
    state,
    storedState: 'S1'
  }).marker);

  assert.deepEqual([...new Set(markers)], [markers[0]], `印が増えている: ${markers.join(', ')}`);
});

// 一方、認証を試み直したときは別の試行として扱う。同じタブで2回目を始めると
// 新しい state が保存されるので、そこで起きた失敗は改めて通報されるべき。
test('確かめられないコールバックでも認証試行ごとに印が変わる', () => {
  const first = buildCallbackReport({
    ...baseInput,
    missingParamKey: 'callbackMissingState',
    storedState: 'S1'
  });
  const retry = buildCallbackReport({
    ...baseInput,
    missingParamKey: 'callbackMissingState',
    storedState: 'S2'
  });

  assert.notEqual(first.marker, retry.marker);
});

// 攻撃ページが iframe でこの画面を10枚並べるだけで、被害者の IP から
// 毎分10件の枠を使い切らせられる。埋め込まれているときは送らない。
test('埋め込まれた文書からは通報しない', () => {
  const report = buildCallbackReport({
    ...baseInput,
    embedded: true,
    error: 'admin_policy_enforced',
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });

  assert.equal(report, null);
});

// 同じコールバックを何度読み直しても、通報は1回に留める。
// 利用者がログインできずリロードを連打するのは自然な反応で、それだけで
// 毎分10件の枠を使い切ってしまう。
test('同じコールバックを識別する印が通報ごとに決まる', () => {
  const first = buildCallbackReport({
    ...baseInput,
    error: 'admin_policy_enforced',
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });
  const same = buildCallbackReport({
    ...baseInput,
    error: 'admin_policy_enforced',
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });
  const different = buildCallbackReport({
    ...baseInput,
    error: 'invalid_request',
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });

  assert.equal(first.marker, same.marker);
  assert.notEqual(first.marker, different.marker);
});

// 生の値はログを1件で埋められないよう丸める。
test('通報に載せる生の値は長さを制限する', () => {
  const report = buildCallbackReport({
    ...baseInput,
    error: 'e'.repeat(500),
    errorDescription: 'd'.repeat(500),
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });

  assert.ok(report.message.length < 600, `通報が長すぎる: ${report.message.length}`);
  assert.match(report.message, /…/);
});

// 説明が重複して届いたとき、実際の原因は後ろの値にあることがある
// （1つ目が定型文、2つ目が redirect_uri_mismatch）。連結してから先頭だけを
// 残すと、残す意味のある方が丸ごと消える。
test('重複した説明は後ろの値も通報に残す', () => {
  const report = buildCallbackReport({
    ...baseInput,
    error: 'invalid_request',
    errorDescription: [
      'A'.repeat(400),
      'redirect_uri_mismatch'
    ].join(DESCRIPTION_SEPARATOR),
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });

  assert.match(report.message, /redirect_uri_mismatch/, '後ろの説明が失われている');
  assert.ok(report.message.length < 600, `通報が長すぎる: ${report.message.length}`);
});

// エントリを増やせば通報を無限に伸ばせる、という抜け道を作らない。
test('説明の数を増やしても通報の長さは頭打ちになる', () => {
  const report = buildCallbackReport({
    ...baseInput,
    error: 'invalid_request',
    errorDescription: Array.from({length: 50}, () => 'B'.repeat(400)).join(DESCRIPTION_SEPARATOR),
    providerErrorKey: 'callbackProviderError',
    state: 'S1',
    storedState: 'S1'
  });

  assert.ok(report.message.length < 600, `通報が長すぎる: ${report.message.length}`);
});

// ---------------------------------------------------------------------------
// 通報の送信と「送信済みの印」
//
// 印はリロード連打で毎分10件/IP の枠を使い切らないために置く。ただし送れなかった
// 通報まで送信済みとして扱うと、その認証試行の診断は永久に失われる。
// オフライン・CORS 拒否・Sentry の読み込み失敗はいずれも復旧しうる。
// ---------------------------------------------------------------------------

function createMarkerStore(initial = null) {
  const state = {forgets: 0, value: initial, writes: 0};

  return {
    marker: {
      forget: () => {
        state.forgets += 1;
        state.value = null;
        return true;
      },
      read: () => state.value,
      write: (value) => {
        state.writes += 1;
        state.value = value;
        return true;
      }
    },
    state
  };
}

const sampleReport = {marker: 'provider-error|S1|invalid_request', message: 'google oauth callback'};

test('同じコールバックの印が残っていれば送らない', async () => {
  const {marker, state} = createMarkerStore(sampleReport.marker);
  const sent = [];

  await deliverCallbackReportOnce(sampleReport, marker, (message) => {
    sent.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(sent, []);
  assert.equal(state.writes, 0);
});

test('送信に成功したら印は残る', async () => {
  const {marker, state} = createMarkerStore();
  const sent = [];

  await deliverCallbackReportOnce(sampleReport, marker, (message) => {
    sent.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(sent, [sampleReport.message]);
  assert.equal(state.value, sampleReport.marker);
  assert.equal(state.forgets, 0);
});

// 送信は非同期なので、印を送信後に書くと連続したマウントで二重に送られる。
test('送信中は印が残り、同じコールバックを二重に送らない', async () => {
  const {marker} = createMarkerStore();
  const sent = [];
  let settle = null;
  const send = (message) => {
    sent.push(message);
    return new Promise((resolve) => {
      settle = resolve;
    });
  };

  const first = deliverCallbackReportOnce(sampleReport, marker, send);
  await deliverCallbackReportOnce(sampleReport, marker, send);

  assert.deepEqual(sent, [sampleReport.message], '送信中に二重で送っている');

  settle(true);
  await first;
});

test('送信に届かなかったら印を取り消して送り直せるようにする', async () => {
  const {marker, state} = createMarkerStore();

  await deliverCallbackReportOnce(sampleReport, marker, () => Promise.resolve(false));

  assert.equal(state.value, null, '届かなかった通報が送信済みとして抑止されている');
  assert.equal(state.forgets, 1);

  const retried = [];
  await deliverCallbackReportOnce(sampleReport, marker, (message) => {
    retried.push(message);
    return Promise.resolve(true);
  });

  assert.deepEqual(retried, [sampleReport.message]);
  assert.equal(state.value, sampleReport.marker);
});

// 印はコールバック1つにつき1つしか置けない。別のコールバックの通報が並行して
// 走り、先に成功して印を書き換えた後で、こちらの失敗が届くことがある。
// そこで無条件に消すと、成功した通報の抑止まで解除され、再描画やリロードで
// 重複して送られてレート枠を削る。
test('失敗した通報は、後から成功した別の通報の印を消さない', async () => {
  const {marker, state} = createMarkerStore();
  const otherReport = {marker: 'missing-state|S2|', message: 'google oauth callback other'};
  let settleFirst = null;

  const first = deliverCallbackReportOnce(sampleReport, marker, () => new Promise((resolve) => {
    settleFirst = resolve;
  }));

  await deliverCallbackReportOnce(otherReport, marker, () => Promise.resolve(true));
  assert.equal(state.value, otherReport.marker);

  settleFirst(false);
  await first;

  assert.equal(state.value, otherReport.marker, '成功した通報の印が消されている');
  assert.equal(state.forgets, 0);
});

// 送信経路が例外を投げても、それを通報し直す手立ては無い（経路そのものが壊れている）。
// 未処理の reject にすると ClientErrorBridge が拾って送信失敗のループになる。
test('送信が例外で終わっても印を取り消し、未処理の reject を残さない', async () => {
  const {marker, state} = createMarkerStore();

  await deliverCallbackReportOnce(sampleReport, marker, () => Promise.reject(new Error('boom')));

  assert.equal(state.value, null);
});
