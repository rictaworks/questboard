import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_THRESHOLDS,
  evaluateMetrics,
  parsePrometheusText,
} from '../scripts/check-sync-metrics.mjs';

/** 本番の /metrics と同じ形。値だけ差し替えて使う */
function metricsText({
  connections = 3,
  slowDrops = 0,
  operationCount = 100,
  withinOneSecond = 100,
} = {}) {
  return [
    '# HELP sync_server_slow_client_drops_total Total number of clients disconnected.',
    '# TYPE sync_server_slow_client_drops_total counter',
    `sync_server_slow_client_drops_total ${slowDrops}`,
    '# HELP sync_server_sync_operation_duration_seconds Time spent processing a confirmed sync operation.',
    '# TYPE sync_server_sync_operation_duration_seconds histogram',
    'sync_server_sync_operation_duration_seconds_bucket{le="0.5"} 0',
    `sync_server_sync_operation_duration_seconds_bucket{le="1"} ${withinOneSecond}`,
    `sync_server_sync_operation_duration_seconds_bucket{le="+Inf"} ${operationCount}`,
    `sync_server_sync_operation_duration_seconds_count ${operationCount}`,
    '# HELP sync_server_websocket_connections Current number of active WebSocket connections.',
    '# TYPE sync_server_websocket_connections gauge',
    `sync_server_websocket_connections ${connections}`,
    '',
  ].join('\n');
}

test('parsePrometheusText はコメント行を無視してラベル付き系列を保持する', () => {
  const values = parsePrometheusText(metricsText());

  assert.equal(values.get('sync_server_websocket_connections'), 3);
  assert.equal(values.get('sync_server_sync_operation_duration_seconds_bucket{le="1"}'), 100);
  assert.equal(values.has('# TYPE sync_server_websocket_connections gauge'), false);
});

test('平常時は閾値超過を報告しない', () => {
  const { breaches, observed } = evaluateMetrics(metricsText());

  assert.deepEqual(breaches, []);
  assert.equal(observed.websocketConnections, 3);
  assert.equal(observed.slowOperationRatio, 0);
});

test('同時接続数が上限を超えたら報告する', () => {
  const { breaches } = evaluateMetrics(
    metricsText({ connections: DEFAULT_THRESHOLDS.maxWebsocketConnections + 1 }),
  );

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].metric, 'sync_server_websocket_connections');
});

test('遅延クライアントの切断が上限を超えたら報告する', () => {
  const { breaches } = evaluateMetrics(
    metricsText({ slowDrops: DEFAULT_THRESHOLDS.maxSlowClientDrops + 1 }),
  );

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].metric, 'sync_server_slow_client_drops_total');
});

test('1秒超の同期処理が比率の上限を超えたら報告する', () => {
  // 100件中5件が1秒超 = 5% > 既定1%
  const { breaches, observed } = evaluateMetrics(
    metricsText({ operationCount: 100, withinOneSecond: 95 }),
  );

  assert.equal(breaches.length, 1);
  assert.equal(breaches[0].metric, 'sync_server_sync_operation_duration_seconds');
  assert.equal(observed.slowOperationRatio, 0.05);
});

test('標本が少ないうちは比率を判定しない', () => {
  // 2件中1件が1秒超（50%）でも、標本数が minOperationSamples 未満なら鳴らさない。
  // 起動直後の数件で毎回アラートが出ると、アラート自体が無視されるようになる
  const { breaches, observed } = evaluateMetrics(
    metricsText({ operationCount: 2, withinOneSecond: 1 }),
  );

  assert.deepEqual(breaches, []);
  assert.equal(observed.slowOperationRatio, null);
});

test('系列そのものが消えていたら報告する', () => {
  const withoutConnections = metricsText()
    .split('\n')
    .filter((line) => !line.startsWith('sync_server_websocket_connections '))
    .join('\n');

  const { breaches } = evaluateMetrics(withoutConnections);

  assert.equal(breaches.length, 1);
  assert.match(breaches[0].message, /sync_server_websocket_connections/);
});
