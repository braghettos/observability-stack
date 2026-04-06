# Krateo Misconfiguration Test Matrix

**Author:** Senior Tester
**Date:** 2026-04-04
**Input:** krateo-platform-expert issue catalog (S1-S32, F1-F29, X1-X5)
**Framework:** `demo/tests/` (Playwright + ClickHouse client + K8s helper)

---

## 1. Test Scenario Matrix

Legend — **Auto**: automatable in current Playwright framework; **Auto+BP**: needs running Portal + deployable broken blueprints; **Browser**: needs real browser DOM assertions; **Infra**: needs new fixture infra (RBAC mutation, pod kill, etc.).

### 1.1 Snowplow RESTAction (S1-S7)

| ID | Scenario | Fault injection | Expected detection (ClickHouse) | Alert / Agent | Remediation hint | Verify | Prio | Automation |
|----|----------|-----------------|---------------------------------|---------------|------------------|--------|------|------------|
| S1 | endpoint-ref-resolve-failed | Apply RESTAction referencing nonexistent Endpoint CR | `otel_logs.body LIKE '%endpoint ref resolve%'` within 60s of GET | `restaction_failure` → krateo-restaction-agent | Create missing Endpoint or fix `endpointRef.name` | Query returns >=1 row; agent invoked in #krateo-troubleshooting | P0 | Auto+BP |
| S2 | api-call-http-failure | Endpoint points to unreachable host (`http://does-not-exist.invalid`) | `body LIKE '%api call http failure%'` + status 5xx in trace | `restaction_failure` → restaction-agent (subclass: endpoint-unreachable) | Fix endpoint URL / DNS / network policy | ClickHouse row within 30s after GET | P0 | Auto+BP |
| S3 | topological-sort-failed | RESTAction with circular dependency in `dependsOn` | `body LIKE '%topological sort%'` | `restaction_failure` → restaction-agent (broken-dependency) | Break dependency cycle | Log row within 10s | P1 | Auto+BP |
| S4 | userinfo-missing | Call RESTAction without auth header | `body LIKE '%userinfo missing%'` | new subclass — covered by restaction runbook | Frontend must forward JWT | Row present; 401-ish path | P1 | Auto |
| S5 | request-options-empty | RESTAction with empty `spec.requestOptions` for method that needs body | `body LIKE '%request options empty%'` | `restaction_failure` | Fill requestOptions | Row present | P2 | Auto+BP |
| S6 | continue-on-error-silent-fail | RESTAction with `continueOnError: true` wrapping a failing call | Only WARN log, no ERROR — currently may be swallowed | **GAP** — need new HyperDX saved search on WARN level w/ body `continueOnError` | restaction-agent | Review continueOnError policy | Confirm WARN row exists | P1 | Auto+BP |
| S7 | response-filter-jq-failed | RESTAction with invalid jq `filter` like `.data[.foo` | `body LIKE '%jq%' AND severity='ERROR'` | `restaction_failure` (bad-jq-filter) | Fix jq expression | Row within 10s | P0 | Auto+BP |

### 1.2 Snowplow Widget (S8-S12)

| ID | Scenario | Fault injection | Detection | Alert / Agent | Remediation | Prio | Automation |
|----|----------|-----------------|-----------|---------------|-------------|------|------------|
| S8 | apiref-resolve-failed | Widget `.spec.apiRef` → missing RESTAction | `body LIKE '%apiRef resolve%'` | `widget_failure` (widget-missing-restaction) → portal-agent | Create RESTAction or fix ref | P0 | Auto+BP |
| S9 | widget-data-resolve-failed | Widget data template references missing field | `body LIKE '%widget data resolve%'` | `widget_failure` (widget-template-error) → portal-agent | Fix template path | P0 | Auto+BP |
| S10 | widgetdatatemplate-setnested-failed | Template tries to set nested field on non-object | `body LIKE '%setNested%'` | `widget_failure` (widget-template-error) | Fix nested path | P1 | Auto+BP |
| S11 | crd-schema-validate-failed | CR that fails CRD schema when widget loads | `body LIKE '%schema validation%'` + CRD name | `widget_failure` + correlate with X2 drift | Re-apply CRD or fix CR | P0 | Auto+BP |
| S12 | resource-refs-resolve-failed | Widget `resourceRefs` → missing CR | `body LIKE '%resource refs resolve%'` | `widget_failure` (widget-error-generic) | Create referenced CR | P1 | Auto+BP |

### 1.3 Snowplow ResourceRefs (S13-S18)

| ID | Scenario | Fault injection | Detection | Alert / Agent | Remediation | Prio | Automation |
|----|----------|-----------------|-----------|---------------|-------------|------|------------|
| S13 | userconfig-missing | Delete user config CM/Secret referenced by resolver | `body LIKE '%userconfig missing%'` | `widget_failure` | Restore config | P1 | Auto+BP |
| S14 | kubeconfig-build-failed | Break kubeconfig secret (invalid base64) | `body LIKE '%kubeconfig build%'` | `widget_failure` or infra_self_healing | Fix Secret | P1 | Infra |
| S15 | group-version-parse-failed | Invalid `apiVersion` in resourceRefs (e.g. `v1//foo`) | `body LIKE '%group version parse%'` | `widget_failure` | Fix apiVersion | P2 | Auto+BP |
| S16 | kind-discovery-failed | resourceRef to nonexistent Kind | `body LIKE '%kind discovery%'` | `widget_failure` | Fix Kind or install CRD | P1 | Auto+BP |
| **S17** | **rbac-denied-on-ref (silent)** | Remove Snowplow SA RBAC for target Kind | Today: empty widget, no log. **Need**: add explicit log before returning empty result | **GAP — no runbook** | new runbook `rbac_denied` | widget shows empty, no error | **P0** | Infra + code change |
| S18 | resourcesrefstemplate-iterator-failed | Template iterator over non-list field | `body LIKE '%iterator%'` | `widget_failure` | Fix template | P1 | Auto+BP |

### 1.4 Snowplow Object Fetch (S19-S22)

| ID | Scenario | Fault injection | Detection | Alert / Agent | Prio | Automation |
|----|----------|-----------------|-----------|--------------|------|------------|
| S19 | objects-get-parse-gv | Malformed GV in query | `body LIKE '%parse groupversion%'` | `widget_failure` | P2 | Auto+BP |
| S20 | objects-get-user-endpoint | User endpoint override broken | `body LIKE '%user endpoint%'` | `restaction_failure` | P2 | Auto+BP |
| **S21** | **objects-get-forbidden (vs 404)** | 403 from kube-apiserver (RBAC gap) | Today conflated w/ 404. **Need**: emit distinct `statusCode: 403` field | **GAP** | new runbook `rbac_denied`; extend restaction_failure w/ subclass | **P0** | Infra |
| S22 | objects-get-notfound | Delete target CR between GET and resolve | `body LIKE '%not found%' AND statusCode=404` | `widget_failure` | P1 | Auto+BP |

### 1.5 Snowplow RBAC (S23-S24)

| ID | Scenario | Fault injection | Detection | Alert / Agent | Prio | Automation |
|----|----------|-----------------|-----------|---------------|------|------------|
| S23 | selfsubjectaccessreview-failed | Remove SSR permission from SA | `body LIKE '%selfsubjectaccessreview%'` | **GAP — no runbook** | **P1** | Infra |
| **S24** | **snowplow-sa-lacks-self-check (HIGH)** | Remove SSR from SA bindings at startup | Today silent; every widget breaks. **Need**: startup probe + ERROR log | **GAP — no runbook; would break everything silently** | new runbook `snowplow_bootstrap_failure`; probe on pod start | **P0** | Infra |

### 1.6 Snowplow CRD schema (S25-S27)

| ID | Scenario | Fault injection | Detection | Alert / Agent | Prio | Automation |
|----|----------|-----------------|-----------|---------------|------|------------|
| S25 | crd-fetch-failed | Delete CRD while widget loads | `body LIKE '%crd fetch%'` | `composition_failure` | P1 | Auto+BP |
| S26 | crd-openapi-parse-failed | Malformed openAPIV3Schema on CRD | `body LIKE '%openapi parse%'` | `composition_failure` | P2 | Auto+BP |
| S27 | crd-property-resolve-failed | Property path not in CRD schema | `body LIKE '%property resolve%'` | `widget_failure` | P2 | Auto+BP |

### 1.7 Snowplow cross-cutting (S28-S32)

| ID | Scenario | Fault injection | Detection | Alert / Agent | Prio | Automation |
|----|----------|-----------------|-----------|---------------|------|------------|
| **S28** | **iterator-concurrent-write-panic** | High-concurrency request to widget w/ iterator template (regression canary) | ClickHouse: `body LIKE '%concurrent map%'` OR goroutine panic stack in `otel_logs` | infra_self_healing (crashloop) + **new runbook** `snowplow_panic` | **P0** | Infra (load test) |
| **S29** | **large-response-oom** | RESTAction fetching huge JSON (>500MB) via mock server | pod OOMKill + **new**: log `response size exceeded` if limit added | `oomkill` today (after crash); proposed: new pre-OOM detection | P0 | Infra |
| S30 | request-timeout | Endpoint that hangs >30s | `body LIKE '%context deadline exceeded%'` | `restaction_failure` (endpoint-unreachable) | P1 | Auto+BP |
| **S31** | **jwt-leaked-to-3rd-party (SECURITY)** | RESTAction w/ Endpoint pointing to attacker-controlled URL, JWT forwarded | **Undetected today**. Need egress-host allowlist check or log `Authorization` header hash w/ dest host | **GAP — no runbook**; SECURITY P0 | new runbook `security_jwt_egress` | **P0** | Infra + policy |
| S32 | negative-cache-staleness | Trigger 404, then create CR; cache serves stale 404 | `body LIKE '%cache hit%' AND statusCode=404` for existing CR | `widget_failure` | P2 | Auto+BP |

### 1.8 Expert's top-10 that need distinct entries

| ID | Scenario | Notes |
|----|----------|-------|
| F10 | sse-event-timeout UX degradation | Browser test — open portal, block SSE endpoint, assert spinner state. **Browser only** | P1 | Browser |
| F4 | widget-status-500-forces-logout | Browser test — inject 500 w/ body `"credentials"`, assert redirect to /login | P1 | Browser |
| F14 | route-resourceref-missing-silent | Delete CR referenced by route; assert 404 vs silent blank | P1 | Browser |

---

## 2. Coverage Gap Analysis

Mapping S1-S32 to existing 6 runbooks:

| Existing runbook | Covers | Missing |
|------------------|--------|---------|
| `oomkill` | S29 (post-mortem) | pre-OOM response-size alert |
| `helm_failure` | none of S* directly | |
| `restaction_failure` | S1, S2, S4, S5, S6, S7, S20, S30 | S3 (broken-dep fits but not explicit), subclass `endpoint-forbidden` missing |
| `widget_failure` | S8, S9, S10, S11, S12, S13, S15, S16, S18, S19, S22, S27, S32 | RBAC-denied subclass |
| `composition_failure` | S25, S26, X2 | |
| `infra_self_healing` | S14, S28 (post-crash) | pre-crash panic signal |

**Uncovered by any runbook (NEW RUNBOOKS NEEDED):**

1. **`rbac_denied`** — covers S17, S21, S23, S24. Specialist: new *krateo-rbac-agent* or route to restaction-agent. Detection requires distinguishing 403 from 404 (see §3).
2. **`snowplow_panic`** — covers S28. Regression canary. Specialist: krateo-snowplow-agent (new).
3. **`security_jwt_egress`** — covers S31. SECURITY. Specialist: dedicated security routing (PagerDuty, not Slack).
4. **`snowplow_bootstrap_failure`** — covers S24 startup self-check. Probe-based.

**Amendments to existing runbooks:**
- `restaction_failure`: add subclass `endpoint-forbidden` (S21) + `userinfo-missing` (S4) + `continue-on-error` (S6).
- `widget_failure`: add subclass `rbac-denied` (S17) pointing to new `rbac_denied` runbook.
- `oomkill`: cross-link to `snowplow_large_response` pre-OOM detection.

**Frontend F1-F29:** None of our 6 runbooks covers browser-side failures. Most F* issues surface server-side as S* (e.g. F1 failed widget render correlates with S8/S9). F4, F10, F14, F24-F27 (auth/SSE) need browser telemetry (RUM via OTel browser SDK) — currently unintegrated. **Gap: no RUM pipeline.**

---

## 3. Detection Additions (HyperDX / ClickHouse native only)

**S17 rbac-denied-on-ref (silent today)** — requires a Snowplow code change to emit an ERROR log when `SelfSubjectAccessReview` returns `allowed: false`. Once emitted, HyperDX saved search:
```sql
SeverityText='ERROR' AND Body LIKE '%rbac denied%' AND ResourceAttributes['service.name']='snowplow'
```

**S21 objects-get-forbidden (indistinguishable from 404)** — Snowplow must surface HTTP status code as a structured attribute. Proposed HyperDX filter once emitted:
```sql
Body LIKE '%objects.get%' AND LogAttributes['http.status_code']='403'
```
Until then, fallback ClickHouse heuristic: correlate burst of 404s targeting same GV+Kind across distinct user SAs (likely RBAC not missing resource):
```sql
SELECT Kind, count(DISTINCT user_sa) c FROM otel_logs WHERE Body LIKE '%not found%' GROUP BY Kind HAVING c>3
```

**S24 snowplow-sa-lacks-self-check** — add Snowplow startup health endpoint that runs SSR against canonical GVK list; emit ERROR on any denial. HyperDX saved search:
```sql
SeverityText='ERROR' AND Body LIKE '%self-check%denied%'
```
Alternative (no code change): periodic synthetic probe via cron job hitting Snowplow `/healthz/rbac`.

**S31 jwt-leaked-to-3rd-party** — two-pronged:
1. **Static**: Snowplow must log `endpoint.host` attribute per outbound call. HyperDX saved search for non-allowlisted hosts:
   ```sql
   LogAttributes['outbound.host'] NOT IN ('kube-apiserver.internal', 'krateo.svc.cluster.local', ...)
   ```
2. **Egress policy**: NetworkPolicy denies egress outside allowlist; log denials from CNI → ClickHouse.

---

## 4. Test Execution Plan (ranked by setup effort)

**Tier 1 — Auto+BP (low effort, reuse existing framework) — ~70% of catalog:**
Deploy broken CR blueprints into `demo-system` namespace, hit the Portal/Snowplow URL, poll ClickHouse via `framework/clients/clickhouse.ts`, assert log row exists within window. Pattern already proven by `scenario2-broken-blueprint.spec.ts`.

Scenarios: S1, S2, S3, S5, S7, S8, S9, S10, S11, S12, S13, S15, S16, S18, S19, S20, S22, S25, S26, S27, S30, S32 (22 scenarios).

Setup: add broken-blueprint fixtures under `demo/tests/fixtures/blueprints/` + one spec file per error class. Est. 3-4 days.

**Tier 2 — Infra (medium effort, new fixtures):**
Scenarios needing RBAC mutations, Secret breakage, pod kills, load generators.

Scenarios: S14, S17, S21, S23, S24, S28, S29, S30, S31 (9 scenarios).

Setup: add `framework/helpers/rbac.ts` (mutate RoleBindings), `framework/helpers/chaos.ts` (kill pods, inject load), mock external HTTP server for S2/S31. Est. 5-7 days. S17/S21/S24/S31 BLOCKED until Snowplow emits the proposed detection signals.

**Tier 3 — Browser (high effort, real DOM):**
Scenarios: F4, F10, F14, F24-F27 (frontend auth/SSE/route behavior).

Setup: extend Playwright with full browser navigation + network intercept (`page.route()`). Est. 3-5 days per scenario. Requires running Portal + mock API. **Recommend: defer to Phase 2.**

**Tier 4 — Code change blocked:**
S17, S21, S24, S31 cannot be tested until Snowplow emits distinguishing signals. **Action: file issues against snowplow repo before writing these specs.**

---

## 5. Recommended next actions

1. File 4 snowplow issues: S17 (RBAC deny log), S21 (403 vs 404 attribute), S24 (startup self-check), S31 (outbound host attribute).
2. Create 4 new runbooks: `rbac_denied`, `snowplow_panic`, `security_jwt_egress`, `snowplow_bootstrap_failure`.
3. Amend `restaction_failure` + `widget_failure` runbooks with new subclasses.
4. Build Tier 1 scenarios first — highest coverage-per-effort. Target: 22 new specs.
5. Integrate OTel browser SDK for RUM before tackling F* scenarios.

Word count: ~1180.
