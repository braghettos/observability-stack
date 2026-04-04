/**
 * ClickHouse client for E2E tests.
 *
 * Queries ClickHouse via HTTP (port 8123) to assert on observability data.
 * Used to verify that events, logs, and metrics flow correctly through the
 * OTel pipeline.
 */

const CLICKHOUSE_URL =
  process.env.CLICKHOUSE_URL ||
  "http://localhost:8123";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || "";

export interface K8sEvent {
  timestamp: string;
  reason: string;
  message: string;
  type: string;
  pod_name: string;
  namespace: string;
  kind: string;
  composition_id: string;
}

export interface LogEntry {
  timestamp: string;
  severity: string;
  body: string;
  pod_name: string;
  namespace: string;
}

export interface TraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  span_name: string;
  service_name: string;
  duration_ms: number;
  status_code: string;
}

/**
 * Execute a raw SQL query against ClickHouse and return parsed JSON rows.
 */
export async function query<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set("query", sql + " FORMAT JSON");

  const headers: Record<string, string> = {};
  if (CLICKHOUSE_USER) {
    headers["Authorization"] =
      "Basic " +
      Buffer.from(`${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`).toString(
        "base64"
      );
  }

  const resp = await fetch(url.toString(), { headers });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `ClickHouse query failed (${resp.status}): ${body.slice(0, 500)}`
    );
  }

  const json = await resp.json();
  return (json.data ?? []) as T[];
}

/**
 * Get recent K8s events for a specific pod/namespace.
 */
export async function getK8sEvents(
  namespace: string,
  podName?: string,
  minutes = 30
): Promise<K8sEvent[]> {
  const podFilter = podName
    ? `AND JSONExtractString(Body, 'object', 'involvedObject', 'name') LIKE '${podName}%'`
    : "";

  return query<K8sEvent>(`
    SELECT
      toString(Timestamp) AS timestamp,
      JSONExtractString(Body, 'object', 'reason') AS reason,
      JSONExtractString(Body, 'object', 'message') AS message,
      JSONExtractString(Body, 'object', 'type') AS type,
      JSONExtractString(Body, 'object', 'involvedObject', 'name') AS pod_name,
      JSONExtractString(Body, 'object', 'involvedObject', 'namespace') AS namespace,
      JSONExtractString(Body, 'object', 'involvedObject', 'kind') AS kind,
      ifNull(LogAttributes['krateo.io/composition-id'], '') AS composition_id
    FROM otel_logs
    WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
      AND JSONExtractString(Body, 'object', 'involvedObject', 'namespace') = '${namespace}'
      ${podFilter}
      AND JSONExtractString(Body, 'object', 'reason') != ''
      AND Timestamp > now() - INTERVAL ${minutes} MINUTE
    ORDER BY Timestamp DESC
    LIMIT 50
  `);
}

/**
 * Get Warning events count for a pod — used for alert verification.
 */
export async function getWarningEventCount(
  namespace: string,
  podName: string,
  minutes = 5
): Promise<number> {
  const rows = await query<{ count: string }>(`
    SELECT count() AS count
    FROM otel_logs
    WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
      AND JSONExtractString(Body, 'object', 'type') = 'Warning'
      AND JSONExtractString(Body, 'object', 'involvedObject', 'name') LIKE '${podName}%'
      AND JSONExtractString(Body, 'object', 'involvedObject', 'namespace') = '${namespace}'
      AND Timestamp > now() - INTERVAL ${minutes} MINUTE
  `);
  return parseInt(rows[0]?.count ?? "0", 10);
}

/**
 * Get pod error logs.
 */
export async function getPodErrorLogs(
  namespace: string,
  podName: string,
  minutes = 30
): Promise<LogEntry[]> {
  return query<LogEntry>(`
    SELECT
      toString(Timestamp) AS timestamp,
      SeverityText AS severity,
      substring(Body, 1, 500) AS body,
      ResourceAttributes['k8s.pod.name'] AS pod_name,
      ResourceAttributes['k8s.namespace.name'] AS namespace
    FROM otel_logs
    WHERE ResourceAttributes['k8s.pod.name'] LIKE '${podName}%'
      AND ResourceAttributes['k8s.namespace.name'] = '${namespace}'
      AND SeverityText IN ('ERROR', 'FATAL')
      AND Timestamp > now() - INTERVAL ${minutes} MINUTE
    ORDER BY Timestamp DESC
    LIMIT 20
  `);
}

/**
 * Get agent execution traces from otel_traces.
 * Requires kagent v0.8.4+ with tracing enabled.
 */
export async function getAgentTraces(
  serviceName?: string,
  minutes = 60
): Promise<TraceSpan[]> {
  const serviceFilter = serviceName
    ? `AND ServiceName = '${serviceName}'`
    : "AND ServiceName LIKE 'krateo-%'";

  return query<TraceSpan>(`
    SELECT
      TraceId AS trace_id,
      SpanId AS span_id,
      ParentSpanId AS parent_span_id,
      SpanName AS span_name,
      ServiceName AS service_name,
      Duration / 1000000 AS duration_ms,
      StatusCode AS status_code
    FROM otel_traces
    WHERE Timestamp > now() - INTERVAL ${minutes} MINUTE
      ${serviceFilter}
    ORDER BY Timestamp DESC
    LIMIT 50
  `);
}
