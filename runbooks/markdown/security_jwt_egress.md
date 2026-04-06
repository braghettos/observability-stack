# Runbook: JWT Token Egress (Security)

## Trigger
- RESTAction with `endpointRef: nil` (no Secret) AND `path` pointing to an external URL
- When endpointRef is nil, snowplow auto-appends the user's JWT as `Authorization: Bearer` header
- The user's token is leaked to the external service

## Severity
P0 — SECURITY CRITICAL. User credentials exfiltrated to third party.

## Primary Specialist
**krateo_restaction_agent** (fix the RESTAction) + **krateo_auth_agent** (assess token scope/damage)

## Detection (proactive — no Snowplow code change needed)
Static analysis of all RESTAction CRs in the cluster:
```
k8s_agent: kubectl get restactions.templates.krateo.io -A -o json
```
For each RESTAction, check `spec.api[].endpointRef`. If nil AND `spec.api[].path` starts with `http://` or `https://` pointing at a non-cluster hostname (not `*.svc`, not `*.svc.cluster.local`), flag it.

## Remediation
1. **Immediate**: Delete or patch the RESTAction to add an `endpointRef` Secret (even with empty token).
2. **Assess damage**: Check how long the RESTAction has been active. User tokens may have been captured.
3. **Rotate tokens**: If the RESTAction was active for > 24h, recommend rotating affected user tokens.
4. **Prevent recurrence**: Add admission webhook or OPA policy blocking RESTActions with nil endpointRef + external URL.

## Verification
Re-scan all RESTActions. Zero should have nil endpointRef + external URL.

## Proactive Scan (run alongside any RESTAction investigation)

When investigating ANY RESTAction issue, also run this cluster-wide security scan:

### S31 — JWT egress scan (all namespaces)
```
k8s_agent: kubectl get restactions.templates.krateo.io -A -o json
```
Parse each RESTAction's `spec.api[]`:
- If `endpointRef` is nil/missing AND `path` starts with `http://` or `https://` AND hostname is NOT `*.svc` or `*.svc.cluster.local` → **FLAG AS SECURITY RISK**
- Report: "RESTAction <ns>/<name> api[<idx>] has nil endpointRef pointing at external host <hostname>. User JWT will be leaked."

This scan requires NO Snowplow code changes — it's pure static analysis of CRs via the K8s API.

## Escalation
Always escalate P0 security issues to the security team regardless of automated fix.
