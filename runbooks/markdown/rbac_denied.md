# Runbook: RBAC Denied (Silent Widget Failures)

## Trigger
- Widgets render empty tables/panels with no visible error
- Snowplow `resource ref action not allowed` (S17 — not logged as ERROR, only payload)
- Snowplow `unable to get resource` + IsForbidden (S21)
- Snowplow `unable to perform SelfSubjectAccessReviews` (S23)
- All widgets failing simultaneously (S24 — snowplow SA missing cluster-level RBAC)

## Severity
P2 (S24 affects ALL users) / P3 (S17/S21 affects single user or resource)

## Primary Specialist
**k8s_agent** (RBAC remediation) + **krateo_auth_agent** (user token issues)

## Diagnosis

### Step 1 — Is this cluster-wide (S24) or per-user (S17/S21)?
If ALL widgets for ALL users are empty → likely S24 (snowplow SA lacks `selfsubjectaccessreviews:create`).
If specific user sees empty widgets → likely S17/S21 (user SA lacks `get` on target GVR).

### Step 2 — Check snowplow SA permissions (S24)
```
k8s_agent: kubectl auth can-i create selfsubjectaccessreviews --as=system:serviceaccount:krateo-system:snowplow
```
If `no` → the snowplow SA needs a ClusterRoleBinding.

### Step 3 — Check per-resource access (S17/S21)
```
k8s_agent: kubectl auth can-i get <resource> --as=<user-sa> -n <namespace>
```

## Remediation
- **S24**: Create ClusterRoleBinding granting snowplow SA `create` on `selfsubjectaccessreviews.authorization.k8s.io`.
- **S17/S21**: Create RoleBinding granting the user's SA `get` on the target GVR in the target namespace.

## Verification
After RBAC fix, reload the portal page. The widget should now show data.
Check snowplow logs for absence of `not allowed` / `unable to get resource` entries.

## Escalation
If RBAC is correct but widgets still empty, escalate to krateo_portal_agent — likely a widget configuration issue, not RBAC.
