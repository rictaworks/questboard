import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

// ---------------------------------------------------------------------------
// 通報経路そのものが暴走しないこと
//
// ClientErrorBridge は window の error と unhandledrejection を購読して
// reportClientError に渡す。つまり通報の送信が未処理の reject や未捕捉の例外を
// 残すと、その失敗自体が次の通報の材料になり、「送信失敗 → 再通報 → 同じ失敗」の
// ループが回り続ける。利用者のブラウザが CPU と通信を消費し続けるため、
// 送信経路は失敗を必ず内側で受け止める。
// ---------------------------------------------------------------------------

const BACKEND_URL = 'https://backend.example.test';

function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, {configurable: true, value, writable: true});
}

// 通報経路が実際に触るブラウザ API だけを差し替えて読み込む。
async function loadModule(relativePath, requireImpl) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, requireImpl);
  return moduleShim.exports;
}

// Sentry 無効時の経路（POST /client_errors）を読み込む。
// sendBeacon の有無と fetch の挙動はテストごとに指定する。
async function loadReporter({sendBeacon, fetchImpl, sentry}) {
  const requireImpl = (specifier) => {
    if (specifier === '@/lib/sentry-sanitizer') {
      return {sanitizeClientErrorUrl: (url) => url};
    }
    if (specifier === '@/lib/sentry-config') {
      return {sentryEnabled: () => sentry !== undefined};
    }
    if (specifier === '@sentry/nextjs') {
      return sentry;
    }
    throw new Error(`unexpected require: ${specifier}`);
  };

  // Node は navigator を getter だけのグローバルとして持つため、代入では差し替え
  // られない。defineProperty で丸ごと置き換える。
  defineGlobal('window', {location: {href: `${BACKEND_URL}/b/token123`}});
  defineGlobal('navigator', {sendBeacon, userAgent: 'test-agent'});
  defineGlobal('fetch', fetchImpl);
  defineGlobal('Blob', class {
    constructor(parts) {
      this.parts = parts;
    }
  });
  process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;

  return loadModule('src/lib/client-error-report.ts', requireImpl);
}

// require で返した @sentry/nextjs を動的 import として渡すため、
// transpile 後の `Promise.resolve().then(() => require(...))` 相当を待ち切る。
// マイクロタスクだけでなくタイマー段階まで進めて、未処理の reject が
// 報告される機会を作る。
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// 未処理の reject を「テスト中に発生したもの」に限って集める。
async function collectUnhandledRejections(run) {
  const rejections = [];
  const listener = (reason) => rejections.push(reason);

  // node --test は既定の unhandledRejection ハンドラでプロセスを落とす。
  // 検査中だけ横取りし、終わったら元に戻す。
  const existing = process.listeners('unhandledRejection');
  for (const handler of existing) {
    process.removeListener('unhandledRejection', handler);
  }
  process.on('unhandledRejection', listener);

  try {
    await run();
    await settle();
  } finally {
    process.removeListener('unhandledRejection', listener);
    for (const handler of existing) {
      process.on('unhandledRejection', handler);
    }
  }

  return rejections;
}

test('バックエンドへの送信が失敗しても未処理の reject を残さない', async () => {
  const {reportClientError} = await loadReporter({
    fetchImpl: () => Promise.reject(new Error('Failed to fetch')),
    sendBeacon: undefined
  });

  const rejections = await collectUnhandledRejections(async () => {
    reportClientError({message: 'oauth error', source: 'x-callback'});
  });

  assert.deepEqual(
    rejections.map((reason) => (reason instanceof Error ? reason.message : String(reason))),
    [],
    'fetch の reject が未処理のまま残っている。ClientErrorBridge がこれを拾って再通報し、'
      + '送信失敗のループになる'
  );
});

// sendBeacon はキューに入れた時点で true を返し、その後の失敗を伝える手段が無い。
// バックエンドは別オリジンにあり application/json は CORS セーフリスト外なので、
// 許可オリジンの設定漏れがあると true を受け取った後に黙って捨てられ、
// フォールバックも走らないまま通報が消える。使わないことを固定する。
test('sendBeacon が使える環境でも beacon では送らない', async () => {
  const beaconCalls = [];
  const attempts = [];
  const {reportClientError} = await loadReporter({
    fetchImpl: (url) => {
      attempts.push(url);
      return Promise.resolve({ok: true, status: 202});
    },
    sendBeacon: (url) => {
      beaconCalls.push(url);
      return true;
    }
  });

  reportClientError({message: 'oauth error', source: 'x-callback'});
  await settle();

  assert.deepEqual(beaconCalls, [], 'sendBeacon が呼ばれている');
  assert.deepEqual(attempts, [`${BACKEND_URL}/client_errors`]);
});

// keepalive を落とすと、コールバック画面から遷移した瞬間に送信が打ち切られ、
// ちょうど診断が要る失敗ほど届かなくなる。
test('通報はページ遷移をまたぐ keepalive つきで送る', async () => {
  const requests = [];
  const {reportClientError} = await loadReporter({
    fetchImpl: (url, options) => {
      requests.push(options);
      return Promise.resolve({ok: true, status: 202});
    },
    sendBeacon: undefined
  });

  reportClientError({message: 'oauth error', source: 'x-callback'});
  await settle();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].keepalive, true);
  assert.equal(requests[0].method, 'POST');
});

test('Sentry の読み込みに失敗しても未処理の reject を残さない', async () => {
  const {reportClientError} = await loadReporter({
    fetchImpl: () => {
      throw new Error('Sentry 有効時にバックエンドへ送ってはならない');
    },
    sendBeacon: undefined,
    sentry: {
      captureMessage: () => {
        throw new Error('Sentry capture failed');
      }
    }
  });

  const rejections = await collectUnhandledRejections(async () => {
    reportClientError({message: 'oauth error', source: 'x-callback'});
  });

  assert.deepEqual(rejections, []);
});

test('Sentry 有効時はバックエンドへ送らず Sentry へ送る', async () => {
  const captured = [];
  const {reportClientError} = await loadReporter({
    fetchImpl: () => {
      throw new Error('Sentry 有効時にバックエンドへ送ってはならない');
    },
    sendBeacon: () => {
      throw new Error('Sentry 有効時にバックエンドへ送ってはならない');
    },
    sentry: {
      captureMessage: (message, options) => captured.push({message, options})
    }
  });

  reportClientError({message: 'oauth error', source: 'x-callback'});
  await settle();

  assert.equal(captured.length, 1);
  assert.equal(captured[0].message, 'oauth error');
  assert.equal(captured[0].options.tags.source, 'x-callback');
});

// ---------------------------------------------------------------------------
// 届いたかどうかを呼び出し側へ返すこと
//
// x-callback は「同じコールバックからは1回だけ送る」ために印を残す。
// 送れなかった通報まで送信済みとして扱うと、オフライン・CORS 拒否・Sentry の
// 読み込み失敗で消えた診断が、その認証試行について二度と得られなくなる。
// 呼び出し側が印を取り消せるよう、届いたかどうかを返す。
// ---------------------------------------------------------------------------

test('バックエンドが受理したら true を返す', async () => {
  const {reportClientError} = await loadReporter({
    fetchImpl: () => Promise.resolve({ok: true, status: 202}),
    sendBeacon: undefined
  });

  assert.equal(await reportClientError({message: 'oauth error', source: 'x-callback'}), true);
});

// オフライン・CORS 拒否・プリフライト遮断はいずれもここに落ちる。
// 復旧しうる失敗なので、送信済みとして扱ってはならない。
test('バックエンドへ届かなければ false を返す', async () => {
  const {reportClientError} = await loadReporter({
    fetchImpl: () => Promise.reject(new Error('Failed to fetch')),
    sendBeacon: undefined
  });

  assert.equal(await reportClientError({message: 'oauth error', source: 'x-callback'}), false);
});

test('バックエンドが受理しなければ false を返す', async () => {
  const {reportClientError} = await loadReporter({
    fetchImpl: () => Promise.resolve({ok: false, status: 500}),
    sendBeacon: undefined
  });

  assert.equal(await reportClientError({message: 'oauth error', source: 'x-callback'}), false);
});

// 送り先が無い状態は「送れなかった」であって「送った」ではない。
test('バックエンドの URL が未設定なら false を返す', async () => {
  const {reportClientError} = await loadReporter({
    fetchImpl: () => {
      throw new Error('URL 未設定のときに送ってはならない');
    },
    sendBeacon: undefined
  });
  delete process.env.NEXT_PUBLIC_BACKEND_URL;

  assert.equal(await reportClientError({message: 'oauth error', source: 'x-callback'}), false);
  process.env.NEXT_PUBLIC_BACKEND_URL = BACKEND_URL;
});

test('Sentry へ送れたら true、読み込みに失敗したら false を返す', async () => {
  const {reportClientError: captured} = await loadReporter({
    fetchImpl: () => {
      throw new Error('Sentry 有効時にバックエンドへ送ってはならない');
    },
    sendBeacon: undefined,
    sentry: {captureMessage: () => {}}
  });

  assert.equal(await captured({message: 'oauth error', source: 'x-callback'}), true);

  const {reportClientError: failed} = await loadReporter({
    fetchImpl: () => {
      throw new Error('Sentry 有効時にバックエンドへ送ってはならない');
    },
    sendBeacon: undefined,
    sentry: {
      captureMessage: () => {
        throw new Error('Sentry capture failed');
      }
    }
  });

  assert.equal(await failed({message: 'oauth error', source: 'x-callback'}), false);
});
