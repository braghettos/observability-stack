# Runbook: Helm Release Failure

## Trigger
- Warning events on a Deployment with reason `FailedCreate` or image pull errors
- User report of a Helm release stuck in `failed` state
- Composition Definition Helm provider reporting errors

## Severity
P2-P3 (depends on release criticality)

## Diagnosis

### Step 1 — Find the affected release (via helm_agent)
```
helm_agent: list releases in the target namespace
```
Look for releases with `status != deployed` (failed, pending-upgrade, pending-rollback, etc.).

### Step 2 — Inspect release details (via helm_agent)
```
helm_agent: get release <name> in namespace <ns> with status and revision history
```
Check:
- Current revision number
- Current status
- Previous successful revision (for rollback target)

### Step 3 — Correlate with K8s events (via krateo_observability_agent)
```sql
SELECT toString(Timestamp) AS ts,
       JSONExtractString(Body, 'object', 'involvedObject', 'kind') AS kind,
       JSONExtractString(Body, 'object', 'involvedObject', 'name') AS name,
       JSONExtractString(Body, 'object', 'reason') AS reason,
       JSONExtractString(Body, 'object', 'message') AS message
FROM otel_logs
WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
  AND JSONExtractString(Body, 'object', 'type') = 'Warning'
  AND JSONExtractString(Body, 'object', 'involvedObject', 'namespace') = '<ns>'
  AND Timestamp > now() - INTERVAL 30 MINUTE
ORDER BY Timestamp DESC LIMIT 20
```

## Decision Tree

- **Release status = failed + previous revision healthy** → rollback
- **Release status = deployed but pods crashing after recent upgrade** → rollback
- **Release status = pending-upgrade stuck** → helm rollback then investigate chart
- **Image pull errors** → verify image tag exists, check registry auth

## Remediation

### Rollback to previous revision (via helm_agent, requires operator approval)
```
helm_agent: rollback release <name> in namespace <ns> to revision <prev_rev>
```

### Inspect values (read-only, via helm_agent)
```
helm_agent: get release <name> in namespace <ns> with values
```

## Verification (via krateo_observability_agent)
Wait 90 seconds after rollback, then:
```sql
SELECT count() AS warning_count
FROM otel_logs
WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
  AND JSONExtractString(Body, 'object', 'type') = 'Warning'
  AND JSONExtractString(Body, 'object', 'involvedObject', 'namespace') = '<ns>'
  AND Timestamp > now() - INTERVAL 2 MINUTE
```
**Success criterion:** `warning_count = 0`

## Escalation
If rollback succeeds but issue recurs, escalate with chart version + values
diff between working and failing revisions.
