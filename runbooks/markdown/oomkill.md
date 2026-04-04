# Runbook: OOMKill Remediation

## Trigger
K8s event with `reason = OOMKilling` (or pod in CrashLoopBackOff with OOMKilled exit reason).

## Severity
P2 (degraded service if production workload)

## Diagnosis (via krateo_observability_agent)

1. Confirm the OOMKill and find affected pod/namespace:
   ```sql
   SELECT toString(Timestamp) AS ts,
          JSONExtractString(Body, 'object', 'involvedObject', 'name') AS pod,
          JSONExtractString(Body, 'object', 'involvedObject', 'namespace') AS ns,
          JSONExtractString(Body, 'object', 'message') AS message
   FROM otel_logs
   WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
     AND JSONExtractString(Body, 'object', 'reason') = 'OOMKilling'
     AND Timestamp > now() - INTERVAL 1 HOUR
   ORDER BY Timestamp DESC LIMIT 10
   ```

2. Check memory utilization trend for that pod (last 2 hours):
   ```sql
   SELECT toStartOfMinute(TimeUnix) AS minute,
          avg(Value) AS avg_util,
          max(Value) AS peak_util
   FROM otel_metrics_gauge
   WHERE MetricName = 'k8s.container.memory_limit_utilization'
     AND ResourceAttributes['k8s.pod.name'] LIKE '<pod>%'
     AND ResourceAttributes['k8s.namespace.name'] = '<ns>'
     AND TimeUnix > now() - INTERVAL 2 HOUR
   GROUP BY minute ORDER BY minute DESC LIMIT 30
   ```

## Decision Tree

- **If avg_util > 0.90 sustained** → legitimate capacity issue, increase limits
- **If spikes from < 0.5 to > 1.0** → memory leak, investigate application code
- **If single-event OOMKill during deploy** → transient, monitor for recurrence

## Remediation

### Increase memory limit (via k8s_agent, requires explicit operator approval)
Patch the deployment to increase memory limit by 50%:
```
k8s_patch_resource:
  kind: deployment
  name: <deployment-name>
  namespace: <ns>
  patch: {"spec":{"template":{"spec":{"containers":[{"name":"<container>","resources":{"limits":{"memory":"<new_limit>"}}}]}}}}
```

### Investigate memory leak (via krateo_code_analysis_agent)
If pattern suggests a leak, delegate to code-analysis-agent to find the source
repository and search for memory-related issues.

## Verification (via krateo_observability_agent)
Wait 2 minutes, then re-query:
```sql
SELECT count() AS oom_count
FROM otel_logs
WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
  AND JSONExtractString(Body, 'object', 'reason') = 'OOMKilling'
  AND JSONExtractString(Body, 'object', 'involvedObject', 'name') LIKE '<pod>%'
  AND Timestamp > now() - INTERVAL 2 MINUTE
```
**Success criterion:** `oom_count = 0`

## Escalation
If 2 remediation attempts fail or pattern indicates ongoing memory leak,
escalate to human operator with full diagnosis context.
