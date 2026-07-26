import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';

const root = process.cwd();

async function loadModule() {
  const source = await readFile(path.join(root, 'src/lib/analytics-tracker.ts'), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  });

  const moduleShim = {exports: {}};
  new Function('module', 'exports', 'require', outputText)(moduleShim, moduleShim.exports, () => {
    throw new Error('unexpected require');
  });

  return moduleShim.exports;
}

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

function createScheduler() {
  let nextId = 0;
  let now = 0;
  const timers = new Map();

  return {
    setTimeout(fn, delay) {
      const id = ++nextId;
      timers.set(id, {fn, runAt: now + delay});
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      const ready = [...timers.entries()].filter(([, timer]) => timer.runAt <= now);
      ready.sort((a, b) => a[1].runAt - b[1].runAt);
      for (const [id, timer] of ready) {
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

function createLogger() {
  return {
    errors: [],
    warns: [],
    error(...args) {
      this.errors.push(args);
    },
    warn(...args) {
      this.warns.push(args);
    },
  };
}

function createFetchStub() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    return {
      ok: true,
      status: 201,
      json: async () => ({accepted: JSON.parse(options.body).events.length}),
    };
  };

  return {calls, fetchImpl};
}

const {AnalyticsTracker, KPI_EVENT_DEFINITIONS} = await loadModule();

test('tracker flushes after ten seconds and preserves batching', async () => {
  const storage = createStorage();
  const scheduler = createScheduler();
  const logger = createLogger();
  const {calls, fetchImpl} = createFetchStub();

  const tracker = new AnalyticsTracker({
    boardId: 42,
    endpointUrl: 'https://backend.test/kpi_events',
    fetchImpl,
    logger,
    offlineBufferLimit: 500,
    storage,
    storageKey: 'questboard.analytics.test',
    userId: 'google-sub-1',
    setTimeoutImpl: scheduler.setTimeout,
    clearTimeoutImpl: scheduler.clearTimeout,
  });

  tracker.track({eventId: KPI_EVENT_DEFINITIONS[0], attributes: {source: 'toolbar'}});
  assert.equal(calls.length, 0);

  scheduler.advance(9_999);
  assert.equal(calls.length, 0);

  scheduler.advance(1);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).events.length, 1);
  assert.equal(storage.values.size, 1);
  assert.equal(logger.errors.length, 0);
});

test('tracker covers the 3 × 2 × buffer-boundary matrix', async () => {
  const cases = [
    {connectionState: 'connected', pii: false, count: 20, expectedFetches: 1, expectedStorageCount: 0},
    {connectionState: 'connected', pii: true, count: 20, expectedFetches: 0, expectedStorageCount: 0},
    {connectionState: 'reconnecting', pii: false, count: 20, expectedFetches: 1, expectedStorageCount: 0},
    {connectionState: 'reconnecting', pii: true, count: 20, expectedFetches: 0, expectedStorageCount: 0},
    {connectionState: 'offline', pii: false, count: 501, expectedFetches: 0, expectedStorageCount: 500},
    {connectionState: 'offline', pii: true, count: 501, expectedFetches: 0, expectedStorageCount: 0},
  ];

  for (const scenario of cases) {
    const storage = createStorage();
    const scheduler = createScheduler();
    const logger = createLogger();
    const {calls, fetchImpl} = createFetchStub();
    const storageKey = `questboard.analytics.${scenario.connectionState}.${scenario.pii}`;
    const tracker = new AnalyticsTracker({
      boardId: 9,
      endpointUrl: 'https://backend.test/kpi_events',
      fetchImpl,
      logger,
      offlineBufferLimit: 500,
      storage,
      storageKey,
      userId: 'google-sub-2',
      setTimeoutImpl: scheduler.setTimeout,
      clearTimeoutImpl: scheduler.clearTimeout,
    });

    tracker.setConnectionState(scenario.connectionState);

    if (scenario.pii) {
      assert.throws(() => {
        tracker.track({
          eventId: KPI_EVENT_DEFINITIONS[10],
          attributes: {email: 'ada@example.com'},
        });
      }, /PII-bearing attribute rejected/);
    } else {
      for (let index = 0; index < scenario.count; index += 1) {
        tracker.track({
          eventId: KPI_EVENT_DEFINITIONS[index % KPI_EVENT_DEFINITIONS.length],
          attributes: {source: 'toolbar', step: index},
        });
      }

      if (scenario.connectionState !== 'offline') {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    assert.equal(calls.length, scenario.expectedFetches);

    const stored = storage.getItem(storageKey);
    if (scenario.expectedStorageCount === 0) {
      if (scenario.connectionState === 'offline') {
        assert.equal(stored, '[]');
      } else if (scenario.pii) {
        assert.equal(stored, null);
      } else {
        assert.equal(stored, '[]');
      }
    } else {
      assert.equal(JSON.parse(stored).length, scenario.expectedStorageCount);
    }
  }
});

test('tracker rejects disallowed PII and logs the hard failure path', () => {
  const storage = createStorage();
  const scheduler = createScheduler();
  const logger = createLogger();
  const {fetchImpl} = createFetchStub();
  const tracker = new AnalyticsTracker({
    boardId: 1,
    endpointUrl: 'https://backend.test/kpi_events',
    fetchImpl,
    logger,
    offlineBufferLimit: 500,
    storage,
    storageKey: 'questboard.analytics.pii',
    userId: 'google-sub-3',
    setTimeoutImpl: scheduler.setTimeout,
    clearTimeoutImpl: scheduler.clearTimeout,
  });

  assert.throws(() => {
    tracker.track({
      eventId: KPI_EVENT_DEFINITIONS[10],
      attributes: {contact: {email: 'ada@example.com'}},
    });
  }, /PII-bearing attribute rejected/);

  assert.equal(logger.errors.length, 1);
  assert.equal(storage.getItem('questboard.analytics.pii'), null);
});
