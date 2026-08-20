#!/usr/bin/env node
// sync-server の /metrics を取得し、閾値を超えていれば非ゼロ終了する。
//
// 外形監視（UptimeRobot）は「落ちている」ことしか見ない。稼働したまま性能が劣化する
// ケース——同時接続の張り付き、同期処理の遅延、遅いクライアントの切断多発——は
// /metrics の値を見ないと分からないため、日次 CI から判定する（issue #23）。
//
// Prometheus + Alertmanager を自前で建てると常時稼働のホストが1台増え、その監視ホスト
// 自身の死活監視という別の問題が生まれる。1人で運用する規模では日次のスナップショット
// 判定で足りるため、既存の CI cron に相乗りしている。

/**
 * Prometheus のテキスト形式を { "系列名": 数値 } に潰す。
 * ヒストグラムのバケットはラベル込みのキー（例 `foo_bucket{le="1"}`）で保持する。
 */
export function parsePrometheusText(text) {
  const values = new Map();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const separator = line.lastIndexOf(' ');
    if (separator === -1) {
      continue;
    }

    const series = line.slice(0, separator).trim();
    const value = Number(line.slice(separator + 1).trim());
    if (Number.isNaN(value)) {
      continue;
    }

    values.set(series, value);
  }

  return values;
}

export const DEFAULT_THRESHOLDS = {
  // 同時接続数。現状の実績（数接続）に対して十分な余裕を持たせつつ、
  // 切断漏れで接続が積み上がる異常には反応する値
  maxWebsocketConnections: 500,
  // 遅延クライアントの強制切断。散発は正常だが継続的に出るなら配信が詰まっている
  maxSlowClientDrops: 20,
  // 同期処理がこの秒数を超えた割合の上限。バケット境界と一致させること
  slowOperationSeconds: 1,
  maxSlowOperationRatio: 0.01,
  // 標本が少ないと1件で比率が跳ねるため、この件数未満は比率を判定しない
  minOperationSamples: 20,
};

/**
 * 取得したメトリクス本文を閾値と突き合わせる。
 * @returns {{observed: object, breaches: Array<{metric: string, observed: number, threshold: number, message: string}>}}
 */
export function evaluateMetrics(text, overrides = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...overrides };
  const values = parsePrometheusText(text);
  const breaches = [];

  const connections = values.get('sync_server_websocket_connections');
  const slowDrops = values.get('sync_server_slow_client_drops_total');
  const operationCount = values.get('sync_server_sync_operation_duration_seconds_count');
  const withinBudget = values.get(
    `sync_server_sync_operation_duration_seconds_bucket{le="${thresholds.slowOperationSeconds}"}`,
  );

  // 系列が消えていること自体が異常。エンドポイントは 200 でも中身が変わった場合に気づけない
  for (const [name, value] of [
    ['sync_server_websocket_connections', connections],
    ['sync_server_slow_client_drops_total', slowDrops],
    ['sync_server_sync_operation_duration_seconds_count', operationCount],
  ]) {
    if (value === undefined) {
      breaches.push({
        metric: name,
        observed: Number.NaN,
        threshold: Number.NaN,
        message: `系列 ${name} が /metrics に存在しない`,
      });
    }
  }

  if (connections !== undefined && connections > thresholds.maxWebsocketConnections) {
    breaches.push({
      metric: 'sync_server_websocket_connections',
      observed: connections,
      threshold: thresholds.maxWebsocketConnections,
      message: `同時接続数が ${connections}（上限 ${thresholds.maxWebsocketConnections}）`,
    });
  }

  if (slowDrops !== undefined && slowDrops > thresholds.maxSlowClientDrops) {
    breaches.push({
      metric: 'sync_server_slow_client_drops_total',
      observed: slowDrops,
      threshold: thresholds.maxSlowClientDrops,
      message: `遅延クライアントの切断が ${slowDrops} 件（上限 ${thresholds.maxSlowClientDrops}）`,
    });
  }

  let slowRatio = null;
  if (
    operationCount !== undefined &&
    withinBudget !== undefined &&
    operationCount >= thresholds.minOperationSamples
  ) {
    slowRatio = (operationCount - withinBudget) / operationCount;
    if (slowRatio > thresholds.maxSlowOperationRatio) {
      breaches.push({
        metric: 'sync_server_sync_operation_duration_seconds',
        observed: slowRatio,
        threshold: thresholds.maxSlowOperationRatio,
        message: `同期処理の ${(slowRatio * 100).toFixed(2)}% が ${thresholds.slowOperationSeconds} 秒超（上限 ${(thresholds.maxSlowOperationRatio * 100).toFixed(2)}%）`,
      });
    }
  }

  return {
    observed: {
      websocketConnections: connections ?? null,
      slowClientDrops: slowDrops ?? null,
      operationCount: operationCount ?? null,
      slowOperationRatio: slowRatio,
    },
    breaches,
  };
}

async function main() {
  const url = process.env.SYNC_METRICS_URL;
  const token = process.env.SYNC_SERVER_METRICS_TOKEN;

  if (!url) {
    console.error('SYNC_METRICS_URL is required');
    process.exit(2);
  }

  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    // 401 はトークン設定漏れ。閾値超過と区別できるよう別の終了コードにする
    console.error(`GET ${url} -> ${response.status}`);
    process.exit(2);
  }

  const { observed, breaches } = evaluateMetrics(await response.text());

  console.log('観測値:', JSON.stringify(observed));

  if (breaches.length === 0) {
    console.log('閾値超過なし');

    return;
  }

  for (const breach of breaches) {
    console.error(`閾値超過: ${breach.message}`);
  }
  process.exit(1);
}

// テストから import したときは実行しない
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
