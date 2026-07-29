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

  tracker.track({eventId: 'camera_panned', attributes: {source: 'toolbar'}});
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
          eventId: 'camera_zoomed',
          attributes: {zoom: 1.0, email: 'ada@example.com'},
        });
      }, /PII-bearing attribute rejected/);
    } else {
      const allowed = ['camera_panned', 'camera_zoomed', 'radial_opened', 'intensity_changed'];
      for (let index = 0; index < scenario.count; index += 1) {
        tracker.track({
          eventId: allowed[index % allowed.length],
          attributes: {source: 'toolbar', step: index, zoom: 1.0, intensity: 'full'},
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
      eventId: 'camera_zoomed',
      attributes: {zoom: 1.0, contact: {email: 'ada@example.com'}},
    });
  }, /PII-bearing attribute rejected/);

  assert.equal(logger.errors.length, 1);
  assert.equal(storage.getItem('questboard.analytics.pii'), null);
});

test('tracker flushes offline buffer upon transitioning back to connected state', async () => {
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
    storageKey: 'questboard.analytics.offline_test',
    userId: 'google-sub-1',
    setTimeoutImpl: scheduler.setTimeout,
    clearTimeoutImpl: scheduler.clearTimeout,
  });

  // Start in offline mode
  tracker.setConnectionState('offline');

  // Track an event while offline (will be written to storage, queue is empty)
  tracker.track({eventId: 'camera_panned', attributes: {source: 'toolbar'}});
  assert.equal(calls.length, 0);

  // Transition to connected state
  tracker.setConnectionState('connected');

  // Advance time to allow the scheduled flush to fire
  scheduler.advance(10_000);
  await new Promise((resolve) => setImmediate(resolve));

  // The event from the offline buffer should have been flushed
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).events.length, 1);
  assert.equal(storage.values.size, 1);
});

test('tracker discards non-whitelisted client events defensively and does not lose whitelisted ones in mixed batches', async () => {
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
    storageKey: 'questboard.analytics.mixed_test',
    userId: 'google-sub-1',
    setTimeoutImpl: scheduler.setTimeout,
    clearTimeoutImpl: scheduler.clearTimeout,
  });

  // Track permitted events and non-permitted events mixed
  tracker.track({eventId: 'camera_zoomed', attributes: {source: 'fit-to-content', zoom: 1.0}});
  // Should be ignored:
  tracker.track({eventId: 'object_created_sticky', attributes: {source: 'toolbar'}});
  tracker.track({eventId: 'camera_panned', attributes: {source: 'minimap'}});
  tracker.track({eventId: 'intensity_changed', attributes: {intensity: 'subtle'}});

  // Verify that only whitelisted events are in the pending queue by flushing once
  await tracker.flush();
  assert.equal(calls.length, 1);
  let sentEvents = JSON.parse(calls[0].options.body).events;
  assert.equal(sentEvents.length, 3); // 'camera_zoomed', 'camera_panned' and 'intensity_changed'
  assert.equal(sentEvents[0].eventId, 'camera_zoomed');
  assert.equal(sentEvents[1].eventId, 'camera_panned');
  assert.equal(sentEvents[2].eventId, 'intensity_changed');

  // Reset fetch calls stub
  calls.length = 0;

  // Directly bypass track() method filter to simulate older events in offline buffer
  // simulating: ['camera_zoomed', 'object_created_sticky', 'camera_panned'] in buffer
  const rawEvent1 = { boardId: 42, attributes: { source: 'fit-to-content', zoom: 1.0 }, eventId: 'camera_zoomed', timestamp: new Date().toISOString(), userId: 'google-sub-1' };
  const rawEvent2 = { boardId: 42, attributes: { source: 'toolbar' }, eventId: 'object_created_sticky', timestamp: new Date().toISOString(), userId: 'google-sub-1' };
  const rawEvent3 = { boardId: 42, attributes: { source: 'minimap' }, eventId: 'camera_panned', timestamp: new Date().toISOString(), userId: 'google-sub-1' };
  const rawEvent4 = { boardId: 42, attributes: { intensity: 'subtle' }, eventId: 'intensity_changed', timestamp: new Date().toISOString(), userId: 'google-sub-1' };

  // Directly persist mixed data into storage
  storage.setItem('questboard.analytics.mixed_test', JSON.stringify([rawEvent1, rawEvent2, rawEvent3, rawEvent4]));

  // Flush the queue again (this time queue is empty, but storage has 4 events)
  await tracker.flush();

  // Non-permitted events must be filtered out before fetch, so only permitted ones should be sent
  assert.equal(calls.length, 1);
  sentEvents = JSON.parse(calls[0].options.body).events;
  assert.equal(sentEvents.length, 3); // 'camera_zoomed', 'camera_panned' and 'intensity_changed'
  assert.equal(sentEvents[0].eventId, 'camera_zoomed');
  assert.equal(sentEvents[1].eventId, 'camera_panned');
  assert.equal(sentEvents[2].eventId, 'intensity_changed');
});

// Regression for issue #72. Node accepts any receiver for setTimeout/clearTimeout/fetch, so the
// browser behaviour is modelled here: WebIDL operations on the global reject a foreign `this`.
function installWebIdlGlobals() {
  const originals = {
    clearTimeout: globalThis.clearTimeout,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
  };
  const receivers = [];

  const requireGlobalReceiver = (name, impl) =>
    function (...args) {
      if (this != null && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      receivers.push(name);
      return impl(...args);
    };

  globalThis.setTimeout = requireGlobalReceiver('setTimeout', () => 1);
  globalThis.clearTimeout = requireGlobalReceiver('clearTimeout', () => undefined);
  globalThis.fetch = requireGlobalReceiver('fetch', async () => ({ok: true, status: 204}));

  return {
    receivers,
    restore() {
      Object.assign(globalThis, originals);
    },
  };
}

test('tracker calls browser globals with a valid receiver when no impls are injected', async () => {
  const storage = createStorage();
  const logger = createLogger();
  const bufferedEvent = {
    boardId: 42,
    attributes: {source: 'toolbar'},
    eventId: 'camera_panned',
    timestamp: new Date().toISOString(),
    userId: 'google-sub-1',
  };
  storage.setItem('questboard.analytics.google-sub-1.42', JSON.stringify([bufferedEvent]));

  const webIdl = installWebIdlGlobals();
  try {
    const tracker = new AnalyticsTracker({
      boardId: 42,
      endpointUrl: 'https://backend.test/kpi_events',
      logger,
      storage,
      userId: 'google-sub-1',
    });

    // setConnectionState runs inside React's commit phase; a throw here crashes the whole board.
    tracker.setConnectionState('connected');
    await tracker.flush();
  } finally {
    webIdl.restore();
  }

  assert.deepEqual([...new Set(webIdl.receivers)].sort(), ['clearTimeout', 'fetch', 'setTimeout']);
  assert.equal(logger.errors.length, 0);
});

test('tracker survives a storage quota failure instead of throwing into the caller', () => {
  const logger = createLogger();
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException('exceeded the quota', 'QuotaExceededError');
    },
  };

  const scheduler = createScheduler();
  const tracker = new AnalyticsTracker({
    boardId: 42,
    endpointUrl: 'https://backend.test/kpi_events',
    fetchImpl: async () => ({ok: true, status: 204}),
    logger,
    storage,
    userId: 'google-sub-1',
    setTimeoutImpl: scheduler.setTimeout,
    clearTimeoutImpl: scheduler.clearTimeout,
  });

  tracker.setConnectionState('offline');
  tracker.track({eventId: 'camera_panned', attributes: {source: 'toolbar'}});

  assert.equal(logger.errors.length, 0);
  assert.ok(logger.warns.length > 0);
});

