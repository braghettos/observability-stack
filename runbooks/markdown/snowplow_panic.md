# Runbook: Snowplow Runtime Panic (Regression Canary)

## Trigger
- Snowplow pod restarts with exit code 2 (panic)
- K8s event `reason=BackOff` for snowplow pod
- Log body contains `runtime error: concurrent map` or `goroutine` stack trace

## Severity
P1 — Snowplow serves ALL portal page rendering. A panic kills the entire portal.

## Primary Specialist
**k8s_agent** (immediate restart) + **krateo_code_analysis_agent** (root cause in source)

## Diagnosis (via krateo_observability_agent)
```sql
SELECT toString(Timestamp) AS ts, substring(Body, 1, 500) AS body
FROM otel_logs
WHERE ResourceAttributes['k8s.pod.name'] LIKE 'snowplow-%'
  AND (Body LIKE '%runtime error%' OR Body LIKE '%goroutine%' OR Body LIKE '%panic%')
  AND Timestamp > now() - INTERVAL 1 HOUR
ORDER BY Timestamp DESC LIMIT 5
```

## Known Panic Sources
- **S28 concurrent map iteration and map write**: in `widgetdatatemplate/resolve.go` — fixed via `deepCopyValue` but regression risk remains. Triggered by concurrent widget resolution with shared map.

## Remediation
1. Pod will auto-restart (restartPolicy: Always). Verify it recovers.
2. If panic recurs on the same request pattern, identify the triggering widget/RESTAction from the stack trace.
3. Delegate to krateo_code_analysis_agent to trace the panic to source code.

## Verification
Snowplow pod is Running with 0 restarts in the last 5 minutes.

## Escalation
If panic recurs > 3 times in 1 hour, the fix requires a Snowplow code change. File a GitHub issue with the full stack trace.
