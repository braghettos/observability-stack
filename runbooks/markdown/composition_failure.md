# Runbook: Composition / CompositionDefinition Reconcile Failure

## Trigger
- Warning events on CompositionDefinition, Composition, or their managed sub-resources
- Composition CR stuck in `Ready=False` state
- Chart fetch failures in core-provider logs

## Severity
P2 (blueprints inoperative — users cannot provision)

## Diagnosis

### Step 1 — Identify the failing composition
```sql
SELECT toString(Timestamp) AS ts,
       JSONExtractString(Body, 'object', 'involvedObject', 'kind') AS kind,
       JSONExtractString(Body, 'object', 'involvedObject', 'name') AS name,
       JSONExtractString(Body, 'object', 'involvedObject', 'namespace') AS ns,
       JSONExtractString(Body, 'object', 'reason') AS reason,
       JSONExtractString(Body, 'object', 'message') AS message
FROM otel_logs
WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
  AND JSONExtractString(Body, 'object', 'type') = 'Warning'
  AND JSONExtractString(Body, 'object', 'involvedObject', 'kind') IN ('CompositionDefinition', 'Composition')
  AND Timestamp > now() - INTERVAL 1 HOUR
ORDER BY Timestamp DESC LIMIT 20
```

### Step 2 — Check controller logs
Controller pods in krateo-system that handle composition lifecycle:
- `core-provider-*` — installs CompositionDefinitions (helm chart fetch)
- `core-provider-chart-inspector-*` — validates charts
- `composition-dynamic-controller-*` — reconciles Composition CRs

```sql
SELECT toString(Timestamp) AS ts,
       ResourceAttributes['k8s.pod.name'] AS pod,
       substring(Body, 1, 250) AS body
FROM otel_logs
WHERE ResourceAttributes['k8s.namespace.name'] = 'krateo-system'
  AND (ResourceAttributes['k8s.pod.name'] LIKE 'core-provider-%'
       OR ResourceAttributes['k8s.pod.name'] LIKE 'composition-dynamic-controller-%')
  AND (Body LIKE '%error%' OR Body LIKE '%failed%' OR Body LIKE '%unable%')
  AND Timestamp > now() - INTERVAL 30 MINUTE
ORDER BY Timestamp DESC LIMIT 20
```

## Decision Tree

- **"failed to fetch chart" / "chart not found"** → `composition-chart-fetch-failed`
  - Wrong OCI URL, missing credentials, registry unreachable
  - Delegate to krateo_blueprint_agent
- **"helm template failed" / "render error"** → `composition-reconcile-failed`
  - Values don't match schema, template syntax error
  - Delegate to krateo_blueprint_agent
- **"admission webhook denied"** → `compositiondefinition-admission-rejected`
  - CRD schema validation blocked the CR
  - Delegate to krateo_blueprint_agent
- **"schema generation failed"** (from oasgen-provider) → `oasgen-schema-generation-failed`
  - OpenAPI spec source is invalid
  - Delegate to krateo_blueprint_agent

## Remediation Delegation

| Symptom | Primary agent | Fallback |
|---------|---------------|----------|
| Chart fetch failure | krateo_blueprint_agent | helm_agent |
| Helm render/template error | krateo_blueprint_agent | helm_agent |
| Values schema mismatch | krateo_blueprint_agent | krateo_restaction_agent |
| Admission denied | krateo_blueprint_agent | k8s_agent |
| Managed sub-resource failed | k8s_agent | krateo_blueprint_agent |

## Verification (via krateo_observability_agent)
After remediation, wait 2 minutes and check the Composition CR status:
```sql
-- Check for new Warning events on the composition
SELECT count() AS warning_count
FROM otel_logs
WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
  AND JSONExtractString(Body, 'object', 'type') = 'Warning'
  AND JSONExtractString(Body, 'object', 'involvedObject', 'name') = '<composition_name>'
  AND Timestamp > now() - INTERVAL 2 MINUTE
```
**Success criterion:** `warning_count = 0`

## Escalation
Composition-level fixes often require developer intervention to update the
CompositionDefinition chart. Create a GitHub issue if the chart source is
unclear or not in a known Krateo repository.
