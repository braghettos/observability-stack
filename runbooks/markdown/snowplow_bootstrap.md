# Runbook: Snowplow Bootstrap / Startup Failure

## Trigger
- Snowplow pod stuck in CrashLoopBackOff after deployment
- All widgets failing simultaneously (different from S24 — here snowplow itself is down)
- Snowplow logs show startup errors (config parse, missing env vars, K8s API unreachable)

## Severity
P1 — Portal is non-functional.

## Primary Specialist
**k8s_agent** (pod diagnostics) + **helm_agent** (if deployed via Helm release)

## Diagnosis

### Step 1 — Check pod status and recent events
```
k8s_agent: kubectl get pods -n krateo-system -l app.kubernetes.io/name=snowplow
k8s_agent: kubectl describe pod snowplow-<hash> -n krateo-system
```

### Step 2 — Check startup logs
```
k8s_agent: kubectl logs -n krateo-system deploy/snowplow --previous
```
Look for: config parse errors, missing REDIS_URL, K8s API connection failures.

### Step 3 — Check redis init container
Snowplow has a `redis` init container. If redis is down, snowplow never starts.
```
k8s_agent: kubectl logs -n krateo-system snowplow-<hash> -c redis
```

## Remediation
- **Missing env vars**: Check the Deployment spec, verify all required env vars are set.
- **Redis init container failing**: Ensure the redis service or embedded redis is healthy.
- **K8s API unreachable**: Check network policies, ServiceAccount token mount.
- **Image pull failure**: Verify image tag exists and registry credentials are configured.

## Verification
Snowplow pod is Running with `1/1 READY`. A portal page loads without errors.

## Escalation
If startup failure persists after env/config fixes, delegate to krateo_blueprint_agent to check if the snowplow Helm release values are correct.
