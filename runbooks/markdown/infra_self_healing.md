# Runbook: Observability Infrastructure Self-Healing

## Trigger
- Absence alert: heartbeat canary stopped producing logs for > 3 minutes
- HyperDX alerts themselves stop firing for known-crashing workloads
- ClickHouse query timeouts in agent MCP calls

## Severity
P1 (the alerting pipeline itself is down — blind spot)

## Critical Components to Check

| Component | Namespace | How to check |
|-----------|-----------|-------------|
| OTel DaemonSet | clickhouse-system | pods running on each node, logs recent |
| OTel Deployment | clickhouse-system | single pod, k8sobjects receiver watching events |
| ClickHouse | clickhouse-system | StatefulSet, accepting queries |
| HyperDX | clickhouse-system | pod running, MongoDB reachable |
| MongoDB | clickhouse-system | StatefulSet, accepting writes |
| a2a-slack-bot | krateo-system | Socket Mode connected to Slack |

## Diagnosis

### Step 1 — Check canary freshness
```sql
SELECT max(Timestamp) AS latest,
       dateDiff('second', max(Timestamp), now()) AS lag_seconds
FROM otel_logs
WHERE ResourceAttributes['k8s.pod.labels.app'] = 'krateo-heartbeat-canary'
  AND TimestampTime > now() - INTERVAL 10 MINUTE
```
If `lag_seconds > 180`, the pipeline has a gap.

### Step 2 — Check per-component log flow
```sql
SELECT ResourceAttributes['k8s.pod.name'] AS pod,
       max(Timestamp) AS latest
FROM otel_logs
WHERE ResourceAttributes['k8s.namespace.name'] = 'clickhouse-system'
  AND TimestampTime > now() - INTERVAL 5 MINUTE
GROUP BY pod ORDER BY latest DESC
```
Look for pods with no recent activity.

### Step 3 — Check OTel collector internal metrics (via k8s_agent)
```
k8s_agent: get pods in namespace clickhouse-system with label app.kubernetes.io/instance=otel-deployment
k8s_agent: get pod logs for otel-deployment-opentelemetry-collector-<hash> --tail 50
```

## Decision Tree

- **Canary logs present but k8s events missing** → OTel Deployment's k8sobjects
  watch disconnected. Restart the Deployment pod.
- **No logs from any component in 3+ min** → OTel DaemonSet down on one or more
  nodes. Check DaemonSet pod status.
- **Logs present but agents can't query** → ClickHouse MCP server down or
  ClickHouse query timeout. Scale MCP server or inspect ClickHouse load.
- **Alerts not firing despite matching events** → HyperDX down or MongoDB
  unreachable.
- **Alerts firing but Slack messages missing** → a2a-slack-bot pod disconnected
  from Slack Socket Mode.

## Remediation (via k8s_agent, requires operator approval)

### Restart OTel Deployment (most common fix)
```
k8s_agent: rollout restart deployment otel-deployment-opentelemetry-collector in namespace clickhouse-system
```

### Restart OTel DaemonSet
```
k8s_agent: rollout restart daemonset otel-daemonset-opentelemetry-collector-agent in namespace clickhouse-system
```

### Restart MCP server
```
k8s_agent: rollout restart deployment clickhouse-mcp-server in namespace krateo-system
```

### Restart Slack bot
```
k8s_agent: rollout restart deployment a2a-slack-bot in namespace krateo-system
```

## Verification
Wait 2 minutes after restart, then re-run Step 1. Canary `lag_seconds` should
drop back to under 90.

## Escalation
If rolling restart does not restore the pipeline, this is a P1 incident:
- Page on-call operator immediately
- Do NOT attempt destructive actions (pod delete, PVC changes)
- Gather: `kubectl describe pod`, `kubectl logs --previous`, `kubectl get events`
