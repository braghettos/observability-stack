# Krateo Agents Orchestration — Consolidated Improvement Plan

**Date:** 2026-04-04
**Team:** krateo-agents-evolution
**Scope:** Closed-loop architecture: alert → diagnose → remediate → verify → confirm
**kagent baseline:** v0.8.4 (2026-04-03)

---

## Executive Summary

This plan consolidates findings from four analysis streams — agent architecture audit, Kubernetes infrastructure & OTel pipeline analysis, runbook/alert workflow evaluation, and test scenario assessment — into a phased improvement roadmap for the Krateo agents orchestration stack.

The current system implements a functional closed-loop (pod crash → OTel → ClickHouse → HyperDX → Slack → KAgent → Autopilot → remediation) but has gaps in verification feedback, infrastructure resilience, runbook coverage, agent orchestration flexibility, and test coverage.

---

## Current State Assessment

### What Works Well
- End-to-end observability pipeline: K8s events → OTel → ClickHouse → HyperDX → Slack → KAgent
- MCP-based agent tooling (ClickHouse MCP Server for diagnosis)
- Custom compositionresolver processor enriching events with `krateo.io/composition-id`
- Two demo scenarios exercising crash-loop and broken-blueprint patterns
- HyperDX auto-resolution detection (ALERT → OK transition via MongoDB state)

### Critical Gaps Identified

| Area | Gap | Severity |
|------|-----|----------|
| **Closed-loop** | No explicit verification step after remediation — agents act but don't confirm fix worked | HIGH |
| **Agent orchestration** | Linear chain only (Autopilot → Obs → k8s → helm); no conditional routing, parallel execution, or retry | HIGH |
| **Infrastructure** | All critical components are single-replica (ClickHouse, OTel Deployment, SSE Proxy, MCP Server) | HIGH |
| **RBAC** | Wildcard `*/*` GET on OTel Deployment ClusterRole is overly permissive | MEDIUM |
| **Runbooks** | Only 2 scenarios covered (pod crash, RESTAction error); no runbooks for OOM, node pressure, agent failures, infra outages | HIGH |
| **Testing** | Playwright test is UI-focused; no end-to-end agent decision quality validation | HIGH |
| **MCP tools** | Only 3 read-only tools (list_databases, list_tables, run_select_query); no write/management tools | MEDIUM |
| **Alert config** | 1-min polling + count>0 threshold risks alert fatigue from transient events | MEDIUM |
| **Credentials** | ClickHouse password in plain text in OTel collector YAML; MCP Server has empty password | MEDIUM |

---

## kagent v0.8.4 Implications

The kagent v0.8.4 release (2026-04-03) introduces capabilities that directly affect multiple items in this plan:

| kagent Change | Impact on Plan |
|---------------|----------------|
| **Go runtime tracing + go-adk 1.0.0** (PR #1618) | Enables item 4.3 (self-observability) with much less effort — agent traces can flow into our existing OTel → ClickHouse pipeline. Also unlocks agent-level latency metrics for item 3.2 (E2E test framework). Reduces 4.3 effort from M to S. |
| **A2A protocol v0.3.13** (PR #1599) | Directly enables item 3.4 (parallel agent execution) — the upgraded agent-to-agent protocol supports concurrent dispatch patterns. Also improves item 2.1 (conditional routing) by providing richer inter-agent communication primitives. |
| **MCP debug logs** (PR #1606) | Improves debugging for item 3.1 (MCP tool expansion) and provides structured diagnostic data for item 2.3 (runbook expansion). MCP tool call traces will be visible in ClickHouse if Go runtime tracing is enabled. |
| **Security: no Privileged when AllowPrivilegeEscalation=false** (PR #1551) | Aligns with item 1.3 (RBAC tightening). Agent skill pods now follow least-privilege by default. |
| **Helm PSA restricted compliance** (PR #1604) | Simplifies item 2.2 (infrastructure HA) — kagent components are now PSA-compliant, removing a blocker for restricted namespace deployment. |

**Action required:** Upgrade kagent to v0.8.4 before starting Phase 1. This is a prerequisite for several items.

---

## Phase 0 — Prerequisite

### 0.1 Upgrade kagent to v0.8.4
- **Description:** Upgrade the kagent deployment to v0.8.4. Enable Go runtime tracing and configure the agent OTel exporter to send traces to our existing OTel Gateway (ClickStack OTLP/HTTP :4318). Verify A2A v0.3.13 compatibility with the existing Autopilot agent chain.
- **Rationale:** v0.8.4 introduces tracing, improved A2A protocol, MCP debug logs, and security fixes that are prerequisites for multiple plan items. The Go runtime tracing feature means agent execution traces will flow into ClickHouse `otel_traces`, giving us end-to-end observability of the agent chain itself.
- **Priority:** P0
- **Effort:** S
- **Dependencies:** None
- **Success criteria:** kagent v0.8.4 running; agent traces visible in ClickHouse `otel_traces`; existing Autopilot → Observability Agent → k8s-agent chain works as before; MCP debug logs appear in agent pod logs

---

## Phase 1 — Foundation (Quick Wins)

### 1.1 Add Post-Remediation Verification to Agent Chain
- **Description:** After k8s-agent or helm-agent performs remediation, the Autopilot should instruct the Observability Agent to re-query ClickHouse after a configurable delay (e.g., 60s) to confirm the issue is resolved. If not resolved, escalate or retry.
- **Rationale:** The current chain is fire-and-forget. Agents remediate but never verify. The closed-loop is open at the verify step.
- **Priority:** P0
- **Effort:** M
- **Dependencies:** Requires kagent Agent CRD update for Autopilot system prompt
- **Success criteria:** After remediation, Autopilot queries ClickHouse and reports "Issue resolved" or "Issue persists — escalating" in Slack

### 1.2 Secure Credential Management
- **Description:** Move ClickHouse passwords from inline YAML values to Kubernetes Secrets. Update OTel collector configs to use `secretKeyRef`. Set a proper password on the MCP Server's ClickHouse connection.
- **Rationale:** Plain-text credentials in version control; MCP Server uses empty password for ClickHouse.
- **Priority:** P0
- **Effort:** S
- **Dependencies:** None
- **Success criteria:** No plain-text passwords in any YAML file; all components use Secret references

### 1.3 Tighten OTel Deployment RBAC
- **Description:** Replace the wildcard `apiGroups: ["*"], resources: ["*"], verbs: [get]` rule with explicit API group listing for krateo.io CRDs that the compositionresolver actually needs.
- **Rationale:** Wildcard GET grants read access to Secrets, ConfigMaps, and all CRDs cluster-wide — excessive for the compositionresolver's label lookup.
- **Priority:** P1
- **Effort:** S
- **Dependencies:** Audit which krateo.io CRDs generate events that need composition-id resolution
- **Success criteria:** ClusterRole lists only the specific apiGroups and resources the compositionresolver needs

### 1.4 Tune Alert Thresholds to Reduce Noise
- **Description:** Change the HyperDX pod restart alert from `count > 0` to `count > 2` within a 5-minute window, and add grouping by pod name to prevent alert storms from multiple pods.
- **Rationale:** A single transient Warning event (e.g., a one-time BackOff that self-recovers) triggers the full agent chain unnecessarily.
- **Priority:** P1
- **Effort:** S
- **Dependencies:** HyperDX alert configuration update
- **Success criteria:** Transient single-event warnings do not trigger the agent chain; sustained issues still fire alerts within 2 minutes

### 1.5 Add Health Probes to MCP Server
- **Description:** Replace the TCP socket probe on the MCP Server with an HTTP probe that actually validates ClickHouse connectivity (e.g., `GET /health` or a lightweight MCP call).
- **Rationale:** TCP probe only confirms the port is open, not that the MCP server can reach ClickHouse or serve queries.
- **Priority:** P1
- **Effort:** S
- **Dependencies:** MCP server image must support a health endpoint (or use a custom probe script)
- **Success criteria:** MCP Server pod restarts if it loses ClickHouse connectivity

---

## Phase 2 — Consolidation

### 2.1 Conditional Agent Routing in Autopilot
- **Description:** Enhance the Autopilot system prompt to implement conditional routing: after diagnosis, route to k8s-agent for pod/deployment issues, helm-agent for release issues, or skip remediation entirely for informational alerts. Add a "no action needed" path.
- **Rationale:** Currently the chain always flows linearly through all agents. A ClickHouse query timeout doesn't need helm-agent.
- **Priority:** P1
- **Effort:** M
- **Dependencies:** kagent Agent CRD update; may require Autopilot prompt engineering
- **Success criteria:** Autopilot correctly routes to the appropriate agent based on diagnosis; logs show routing decision rationale

### 2.2 Infrastructure High Availability
- **Description:** Scale critical single-replica components:
  - OTel Deployment: 2 replicas with leader election for k8sobjects watch
  - SSE Proxy: 2 replicas (stateless, easy to scale)
  - MCP Server: 2 replicas behind the existing ClusterIP Service
  - ClickHouse: evaluate ClickHouse Keeper for multi-replica (separate initiative due to complexity)
- **Rationale:** Single-replica components are SPOFs. OTel Deployment failure means K8s events stop flowing to ClickHouse, breaking the entire alert pipeline.
- **Priority:** P1
- **Effort:** L
- **Dependencies:** OTel Deployment leader election requires Helm chart support; ClickHouse HA requires storage and Keeper configuration
- **Success criteria:** Pipeline continues operating during single-pod restarts for all components except ClickHouse (HA deferred)

### 2.3 Expand Runbook Coverage
- **Description:** Create runbooks (as structured documents the Autopilot can reference) for:
  1. **OOM Kill** — detect via K8s events (OOMKilling reason), diagnose memory usage via kubeletstats metrics, remediate via resource limit patch
  2. **Node Pressure** — detect via k8s_cluster receiver (node conditions), diagnose affected pods, remediate via cordon + reschedule
  3. **Helm Release Failure** — detect via composition errors, diagnose via `helm-agent GetRelease`, remediate via rollback
  4. **Agent Infrastructure Failure** — detect via MCP Server / OTel unavailability, fallback to direct kubectl diagnostics
  5. **False Positive Handling** — detect repeated alert-resolve cycles for the same resource, suppress after N cycles
- **Rationale:** Only 2 scenarios are covered today (pod crash, RESTAction error). Real production clusters encounter many more failure modes.
- **Priority:** P1
- **Effort:** L
- **Dependencies:** Item 2.1 (conditional routing) for proper runbook dispatch
- **Success criteria:** Each new runbook has a documented trigger condition, diagnosis steps, remediation actions, and verification criteria

### 2.4 Runbook-as-Code Format
- **Description:** Define a structured YAML/JSON format for runbooks that agents can parse programmatically. Include fields: `trigger_condition` (ClickHouse query), `diagnosis_steps` (ordered MCP queries), `remediation_actions` (agent tool calls), `verification_query` (ClickHouse query to confirm fix), `escalation_criteria`.
- **Rationale:** Free-text runbooks in markdown require LLM interpretation with each invocation. Structured runbooks enable deterministic agent behavior for known scenarios.
- **Priority:** P2
- **Effort:** M
- **Dependencies:** Item 2.3 (runbook content exists first)
- **Success criteria:** Autopilot can load a runbook YAML and execute its steps without relying on LLM judgment for known scenarios

### 2.5 Add Compositionresolver Cache Eviction
- **Description:** The compositionresolver processor's in-memory cache (`map[string]cacheEntry`) grows unbounded — expired entries are only skipped on lookup, never deleted. Add a periodic sweep goroutine (e.g., every 10 minutes) to evict expired entries.
- **Rationale:** In a long-running OTel collector processing events for thousands of resources, the cache map will accumulate stale entries indefinitely.
- **Priority:** P2
- **Effort:** S
- **Dependencies:** None — code change in `otel-collector-custom/compositionresolver/processor.go`
- **Success criteria:** Cache size stabilizes over time; memory usage of OTel Deployment does not grow monotonically

---

## Phase 3 — Evolution

### 3.1 Expand MCP Server Toolset
- **Description:** Add MCP tools beyond read-only queries:
  - `describe_table(database, table)` — returns schema, engine, partition info
  - `get_query_stats(query_id)` — execution time, rows read, memory used
  - `get_recent_errors(namespace, pod, minutes)` — pre-built diagnostic query
  - `get_pod_timeline(namespace, pod, hours)` — correlate events + logs + metrics for a single pod
  - `get_alert_context(alert_id)` — pre-built query returning the data that triggered a specific alert
- **Rationale:** Agents currently craft raw SQL queries. Pre-built diagnostic tools reduce LLM hallucination risk and ensure consistent, efficient queries.
- **Priority:** P2
- **Effort:** L
- **Dependencies:** MCP server code changes or a custom wrapper MCP server
- **Success criteria:** Observability Agent uses pre-built tools for common diagnostic patterns instead of raw SQL 80%+ of the time

### 3.2 End-to-End Agent Test Framework
- **Description:** Build a test framework that validates the full closed-loop:
  1. **Inject fault** (deploy crashloop pod, break a RESTAction endpoint)
  2. **Wait for alert** (poll HyperDX or watch Slack channel via API)
  3. **Verify agent activation** (check kagent session was created)
  4. **Verify diagnosis quality** (agent correctly identified root cause)
  5. **Verify remediation** (agent took appropriate action)
  6. **Verify resolution** (alert transitions to OK)
  - Framework should be CLI-based (not Playwright/browser) for CI integration
- **Rationale:** Current Playwright test only validates the UI trigger path. No test validates agent decision quality or the full loop.
- **Priority:** P2
- **Effort:** XL
- **Dependencies:** Items 1.1 (verification step), 2.1 (routing)
- **Success criteria:** CI pipeline runs full closed-loop test; test reports include agent decision accuracy metrics

### 3.3 Multi-Agent Coordination Tests
- **Description:** Test scenarios requiring multiple agents to coordinate:
  1. **Cascading failure** — pod crash causes Helm release health check to fail; both k8s-agent and helm-agent must coordinate
  2. **Concurrent alerts** — two different pods crash simultaneously; Autopilot handles both without interference
  3. **Agent failure recovery** — MCP Server goes down mid-diagnosis; Autopilot retries or escalates
- **Rationale:** Current tests only exercise single-agent, single-alert scenarios. Production will have concurrent, interrelated failures.
- **Priority:** P2
- **Effort:** L
- **Dependencies:** Item 3.2 (test framework exists)
- **Success criteria:** All three coordination scenarios pass reliably

### 3.4 Parallel Agent Execution
- **Description:** Enable the Autopilot to dispatch diagnosis and remediation to multiple agents in parallel when the situation warrants it (e.g., query ClickHouse for logs while simultaneously checking Helm release status). Leverage kagent v0.8.4's upgraded A2A protocol (v0.3.13) which provides improved inter-agent communication primitives for concurrent dispatch.
- **Rationale:** Linear agent chain adds latency. Parallel execution reduces time-to-resolution for complex scenarios. A2A v0.3.13 in kagent v0.8.4 makes this feasible without custom orchestration code.
- **Priority:** P2
- **Effort:** M (reduced from L — A2A v0.3.13 provides the primitives)
- **Dependencies:** Item 0.1 (kagent v0.8.4 upgrade), item 2.1 (conditional routing)
- **Success criteria:** Mean time from alert to resolution decreases by 30%+ for multi-agent scenarios

### 3.5 Alert Deduplication and Correlation
- **Description:** Add an alert correlation layer (either in HyperDX configuration or as an autopilot-alert-proxy enhancement) that:
  - Deduplicates alerts for the same resource within a configurable window
  - Correlates related alerts (e.g., pod restart + OOM kill for the same pod)
  - Presents the Autopilot with a single correlated incident rather than multiple independent alerts
- **Rationale:** Alert storms from cascading failures can overwhelm the agent chain, creating duplicate remediation attempts.
- **Priority:** P2
- **Effort:** M
- **Dependencies:** autopilot-alert-proxy code changes
- **Success criteria:** N related alerts within a 5-minute window produce a single agent invocation with full context

---

## Phase 4 — Excellence

### 4.1 Self-Healing Adaptive Behavior
- **Description:** Implement a feedback loop where the Autopilot learns from past incidents:
  - Store incident outcomes in ClickHouse (diagnosis accuracy, remediation success, time-to-resolution)
  - Before acting on a new alert, query past incidents for the same resource/pattern
  - If a previous remediation failed, try an alternative approach
  - If a pattern recurs >3 times, escalate to human with recommendation for permanent fix
- **Rationale:** Agents currently treat each incident independently. Pattern recognition across incidents enables smarter responses.
- **Priority:** P3
- **Effort:** XL
- **Dependencies:** Items 1.1, 2.4, 3.2
- **Success criteria:** Repeat incidents show decreasing time-to-resolution; recurring patterns generate proactive recommendations

### 4.2 Proactive Monitoring Agent
- **Description:** Add a new agent (or Autopilot capability) that proactively monitors trends:
  - Periodically query ClickHouse for anomalies (memory growth, error rate increases, latency degradation)
  - Alert before failures occur (predictive, not reactive)
  - Suggest preemptive actions (scale up before OOM, rotate pods before crash)
- **Rationale:** Current system is entirely reactive — it waits for alerts. Proactive monitoring prevents incidents.
- **Priority:** P3
- **Effort:** XL
- **Dependencies:** Item 3.1 (expanded MCP tools), stable incident history
- **Success criteria:** At least 20% of incidents are prevented by proactive agent action

### 4.3 Observability of the Observability Stack
- **Description:** Instrument the observability stack itself:
  - OTel collector internal metrics exported to ClickHouse (dropped logs, queue depth, export errors)
  - MCP Server request latency and error rates (kagent v0.8.4 MCP debug logs provide a starting point)
  - SSE Proxy connection count and event throughput
  - HyperDX alert evaluation latency
  - Agent session duration and outcome metrics (kagent v0.8.4 Go runtime tracing provides these out of the box via `otel_traces`)
- **Rationale:** The observability stack monitors the platform but doesn't monitor itself. A silent OTel failure means alerts stop firing. With kagent v0.8.4's Go runtime tracing, agent traces already flow into ClickHouse — this item now focuses on the remaining non-agent components.
- **Priority:** P3
- **Effort:** S (reduced from M — kagent v0.8.4 tracing covers agent metrics automatically)
- **Dependencies:** Item 0.1 (kagent v0.8.4 upgrade)
- **Success criteria:** Dashboard showing health of all observability components; alert when any component degrades

### 4.4 Chaos Engineering for Agent Resilience
- **Description:** Integrate chaos engineering (e.g., LitmusChaos or manual fault injection) to continuously test agent resilience:
  - Kill MCP Server during agent diagnosis
  - Introduce ClickHouse query latency (>30s)
  - Simulate Slack webhook failures
  - Network partition between OTel and ClickHouse
- **Rationale:** Agent behavior under infrastructure degradation is untested. Real-world failures are unpredictable.
- **Priority:** P3
- **Effort:** L
- **Dependencies:** Item 3.2 (test framework)
- **Success criteria:** Agents gracefully degrade (escalate to human, retry, or report inability) rather than silently failing

---

## Dependency Graph

```
Phase 0 (Prerequisite)
└── 0.1 Upgrade kagent to v0.8.4 ← (no deps)

Phase 1 (Foundation)
├── 1.1 Post-remediation verification ← 0.1
├── 1.2 Secure credentials ← (no deps)
├── 1.3 Tighten RBAC ← (no deps)
├── 1.4 Alert threshold tuning ← (no deps)
└── 1.5 MCP health probes ← (no deps)

Phase 2 (Consolidation)
├── 2.1 Conditional routing ← 0.1, 1.1
├── 2.2 Infrastructure HA ← (no deps)
├── 2.3 Runbook expansion ← 2.1
├── 2.4 Runbook-as-code ← 2.3
└── 2.5 Cache eviction ← (no deps)

Phase 3 (Evolution)
├── 3.1 MCP tool expansion ← (no deps)
├── 3.2 E2E test framework ← 0.1, 1.1, 2.1
├── 3.3 Multi-agent tests ← 3.2
├── 3.4 Parallel execution ← 0.1, 2.1
└── 3.5 Alert deduplication ← (no deps)

Phase 4 (Excellence)
├── 4.1 Adaptive behavior ← 1.1, 2.4, 3.2
├── 4.2 Proactive agent ← 3.1
├── 4.3 Self-observability ← 0.1
└── 4.4 Chaos engineering ← 3.2
```

---

## Priority Summary

| Priority | Items | Theme |
|----------|-------|-------|
| **P0** | 0.1, 1.1, 1.2 | Upgrade kagent; close the verification gap; secure credentials |
| **P1** | 1.3, 1.4, 1.5, 2.1, 2.2, 2.3 | Harden infrastructure; enable smart routing; expand coverage |
| **P2** | 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5 | Structured automation; comprehensive testing; performance |
| **P3** | 4.1, 4.2, 4.3, 4.4 | Adaptive intelligence; proactive monitoring; resilience |

---

## Effort Estimates

| Size | Items | Approximate Scope |
|------|-------|-------------------|
| Size | Items | Approximate Scope |
|------|-------|-------------------|
| **S** (days) | 0.1, 1.2, 1.3, 1.4, 1.5, 2.5, 4.3 | Config changes, upgrades, minor code updates |
| **M** (1-2 weeks) | 1.1, 2.1, 2.4, 3.4, 3.5 | Prompt engineering, moderate code changes |
| **L** (2-4 weeks) | 2.2, 2.3, 3.1, 3.3, 4.4 | Multi-component changes, new capabilities |
| **XL** (1-2 months) | 3.2, 4.1, 4.2 | New frameworks, complex integrations |
