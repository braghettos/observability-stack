# Krateo Agents Architecture

**Date:** 2026-04-06
**Cluster:** gke_neon-481711_us-central1-a_cluster-1
**kagent version:** v0.8.4 (CRD: kagent.dev/v1alpha2)

---

## Overview

The Krateo agent orchestration runs 14 AI agents coordinated by a central **Autopilot** agent. Users interact through Slack (`#krateo-troubleshooting` channel), where the **a2a-slack-bot** translates `@KAgent` mentions into A2A (Agent-to-Agent) protocol calls against the Autopilot.

The system handles two modes:
- **Adoption mode** — users ask how to create blueprints, configure widgets, set up RESTActions, manage auth
- **Troubleshooting mode** — alerts fire from HyperDX → Slack → Autopilot → SRE agent → specialist sub-agents

All agents run as Kubernetes Deployments managed by the kagent controller. Agent definitions are `kagent.dev/v1alpha2 Agent` CRDs. System prompts live in a shared `krateo-prompts-eng` ConfigMap referenced via `promptTemplate.dataSources`.

---

## Architecture Diagram

```
                        ┌─────────────────┐
                        │   Slack Channel  │
                        │ #krateo-trouble  │
                        └────────┬────────┘
                                 │ @KAgent mention
                        ┌────────▼────────┐
                        │  a2a-slack-bot   │
                        │ (Socket Mode)    │
                        └────────┬────────┘
                                 │ A2A protocol
                        ┌────────▼────────┐
                        │ krateo-autopilot │
                        │ (orchestrator)   │
                        │ gemini-flash     │
                        │ stream: true     │
                        └────────┬────────┘
                                 │ routes to specialist
         ┌──────────┬────────────┼────────────┬──────────┐
         ▼          ▼            ▼            ▼          ▼
   ┌──────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ ┌────────────┐
   │SRE Agent │ │Blueprint│ │Portal    │ │Auth    │ │Documentation│
   │(incident)│ │Agent    │ │Agent     │ │Agent   │ │Agent       │
   └────┬─────┘ └────────┘ └──────────┘ └────────┘ └────────────┘
        │ delegates
   ┌────┼──────────────┐
   ▼    ▼              ▼
┌──────┐ ┌───────┐ ┌──────────────┐
│Observ.│ │k8s-   │ │code-analysis │
│Agent  │ │agent  │ │agent         │
└──┬────┘ └───────┘ └──────────────┘
   │ queries
   ▼
┌──────────────────┐
│ ClickHouse MCP   │
│ (otel_logs,      │
│  otel_metrics,   │
│  otel_traces)    │
└──────────────────┘
```

---

## Agent Inventory

### Tier 1 — Orchestrator

| Agent | Model | Stream | Description |
|-------|-------|--------|-------------|
| **krateo-autopilot** | gemini-2.5-flash | true | Central orchestrator. Routes user requests to the appropriate specialist. Only agent that streams to Slack. |

**Tools:** kagent-tool-server (k8s_apply_manifest, k8s_get_resources) + 13 sub-agents as A2A tools.

**Routing logic** (from system prompt):
- Alerts / troubleshooting → `krateo-sre-agent` (ALWAYS, never self-diagnose)
- Auth questions → `krateo-auth-agent`
- Blueprint / CompositionDefinition → `krateo-blueprint-agent`
- Portal / widgets → `krateo-portal-agent`
- RESTActions → `krateo-restaction-agent`
- Krateo docs / concepts → `krateo-documentation-agent`
- Direct K8s operations → `k8s-agent`
- Helm operations → `helm-agent`
- Source code analysis → `krateo-code-analysis-agent`
- Ansible → operator → `krateo-ansible-to-operator-agent`
- Terraform → operator → `krateo-tf-provider-to-operator-agent`
- Terraform → Helm → `krateo-tf-to-helm-agent`

### Tier 2 — Domain Specialists

| Agent | Model | Domain | Tools |
|-------|-------|--------|-------|
| **krateo-sre-agent** | gemini-2.5-pro | Incident response, alert triage, runbook execution, SLO/SLI | ClickHouse MCP (3 tools), kagent-tool-server (1 tool), sub-agents: observability, code-analysis, k8s, auth |
| **krateo-blueprint-agent** | gemini-2.5-pro | CompositionDefinitions, Helm charts, compositions | kagent-tool-server (3), krateo-blueprint-tools (6), github-mcp-server (7) |
| **krateo-portal-agent** | gemini-2.5-flash | Widget CRDs, portal pages, forms, actions | kagent-tool-server (2), krateo-portal-tools (2) |
| **krateo-restaction-agent** | gemini-2.5-flash | RESTAction CRDs, endpoint configuration, jq filters | *(no tools — uses knowledge from prompts)* |
| **krateo-auth-agent** | gemini-2.5-flash | Auth strategies, LDAP, OIDC, OAuth, user management | kagent-tool-server (3) |
| **krateo-documentation-agent** | gemini-2.5-flash | Krateo architecture, concepts, capabilities | *(no tools — uses knowledge from prompts)* |
| **krateo-code-analysis-agent** | gemini-2.5-pro | GitHub source tracing, error pattern search, commit analysis | github-mcp-server (10), kagent-tool-server (3) |

### Tier 3 — Infrastructure Operators

| Agent | Model | Domain | Tools |
|-------|-------|--------|-------|
| **k8s-agent** | gemini-2.5-flash | Kubernetes operations: get, describe, patch, delete, apply, exec, scale, rollout | kagent-tool-server (20 tools) |
| **helm-agent** | gemini-2.5-flash | Helm: list, get, install, upgrade, rollback, uninstall, repo management | kagent-tool-server (9 tools) |
| **krateo-observability-agent** | gemini-2.5-pro | ClickHouse queries: pod logs, K8s events, metrics, traces | ClickHouse MCP (3 tools: list_databases, list_tables, run_select_query) |

### Tier 4 — Migration Specialists

| Agent | Model | Domain |
|-------|-------|--------|
| **krateo-ansible-to-operator-agent** | gemini-2.5-pro | Ansible playbooks → K8s Operator SDK operators |
| **krateo-tf-provider-to-operator-agent** | gemini-2.5-pro | Terraform providers → K8s operators (ACK, Config Connector, Crossplane) |
| **krateo-tf-to-helm-agent** | gemini-2.5-pro | Terraform modules → Helm charts |

---

## MCP Servers (Tool Providers)

| Server | URL | Tools | Used by |
|--------|-----|-------|---------|
| **kagent-tool-server** | `http://kagent-tools.krateo-system:8084/mcp` | k8s_get_resources, k8s_apply_manifest, k8s_describe_resource, k8s_get_pod_logs, k8s_patch_resource, k8s_delete_resource, k8s_execute_command, k8s_scale, k8s_rollout, + 11 more | Autopilot, k8s-agent, helm-agent, blueprint-agent, portal-agent, auth-agent, code-analysis-agent |
| **clickhouse-mcp-server** | `http://clickhouse-mcp-server.krateo-system:8000/sse` | list_databases, list_tables, run_select_query | Observability-agent, SRE-agent |
| **github-mcp-server** | `http://github-mcp-server.krateo-system:3000/mcp` | search_code, get_file_contents, list_commits, create_branch, create_pull_request, + 5 more | Blueprint-agent, code-analysis-agent |
| **krateo-blueprint-tools** | `http://krateo-blueprint-tools:8080/mcp` | 6 tools (blueprint-specific operations) | Blueprint-agent |
| **krateo-portal-tools** | `http://krateo-portal-tools:8080/mcp` | 2 tools (portal-specific operations) | Portal-agent |

---

## Knowledge System (promptTemplate.dataSources)

Agents load knowledge at startup via ConfigMaps referenced in their Agent CRD's `spec.declarative.promptTemplate.dataSources`. Each ConfigMap key is accessible via `{{include "alias/key"}}` in the system prompt.

### ConfigMaps

| ConfigMap | Alias | Keys | Agents |
|-----------|-------|------|--------|
| **krateo-prompts-eng** | `prompts` | autopilot, sre_agent, observability_agent, portal_agent, restaction_agent, blueprint_agent, auth_agent, documentation_agent, code_analysis_agent, ansible_to_operator_agent, tf_provider_to_operator_agent, tf_to_helm_agent | All 14 agents |
| **krateo-runbooks** | `runbooks` | oomkill, helm_failure, restaction_failure, widget_failure, composition_failure, infra_self_healing, rbac_denied, security_jwt_egress, snowplow_panic, snowplow_bootstrap | SRE-agent only |
| **krateo-portal-knowledge** | `knowledge` | portal_guide, widget_quick_reference, form_autocomplete, form_values, guide_simple_page, guide_action_button | Portal, RESTAction, Blueprint, Auth agents |
| **krateo-agent-guardrails** | `guardrails` | guardrails (data sufficiency, empty response, bare-pod preflight, escalation timeout) | All 10 sub-agents |

### Knowledge flow

```
Agent CRD
  └── spec.declarative.promptTemplate.dataSources
        ├── {alias: prompts, ConfigMap: krateo-prompts-eng}
        ├── {alias: runbooks, ConfigMap: krateo-runbooks}        ← SRE only
        ├── {alias: knowledge, ConfigMap: krateo-portal-knowledge}  ← specialists
        └── {alias: guardrails, ConfigMap: krateo-agent-guardrails} ← all sub-agents
              ↓
        kagent template engine expands {{include "alias/key"}}
              ↓
        Agent's system prompt at runtime
```

---

## Model Configuration

| Config name | Provider | Model | Used by |
|-------------|----------|-------|---------|
| **gemini-flash** | Gemini | gemini-2.5-flash | Autopilot, k8s-agent, helm-agent, portal-agent, restaction-agent, auth-agent, documentation-agent |
| **gemini-pro** | Gemini | gemini-2.5-pro | SRE-agent, observability-agent, blueprint-agent, code-analysis-agent, migration agents |

**Design rationale:** Flash for low-latency routing and simple tasks. Pro for complex reasoning (diagnosis, code analysis, blueprint generation).

---

## Streaming Architecture

| Agent | stream | Why |
|-------|--------|-----|
| **krateo-autopilot** | `true` | User-facing — Slack shows incremental response |
| **All 13 sub-agents** | `false` | A2A tool calls with `stream:true` return empty results to the caller immediately. With `stream:false`, the full response is returned synchronously. |

**Root cause (observed bug):** When the Autopilot calls a sub-agent via A2A with streaming enabled, the A2A client receives an empty `{'result': ''}` immediately while the sub-agent runs asynchronously. The Autopilot interprets this as "done" and responds "I delegated, will update later" — but never follows up. Setting sub-agents to `stream:false` forces synchronous completion, returning the full response.

---

## Alert → Agent Flow (Troubleshooting Mode)

```
1. OTel collectors ingest K8s events + pod logs → ClickHouse (otel_logs)
2. HyperDX polls ClickHouse every 1min via saved searches
3. Threshold breached → HyperDX fires webhook to Slack with @KAgent mention
4. a2a-slack-bot (Socket Mode) receives @mention → creates A2A task on krateo-autopilot
5. Autopilot routes ALL alerts to krateo-sre-agent (system prompt rule)
6. SRE agent follows runbook workflow:
   a. DIAGNOSE: delegates to krateo-observability-agent (queries ClickHouse)
   b. CLASSIFY: MANIFEST_ERROR / INFRASTRUCTURE / APPLICATION_BUG / TRANSIENT / FALSE_POSITIVE
   c. ACT: delegates to k8s-agent, helm-agent, or krateo-code-analysis-agent
   d. VERIFY: delegates back to observability-agent to confirm fix
   e. REPORT: structured incident report posted to Slack thread
7. If remediation fails after 2 attempts → ESCALATE to human
```

### Runbooks (10 total)

The SRE agent has 10 runbooks loaded via `promptTemplate.dataSources` from the `krateo-runbooks` ConfigMap. Each runbook specifies: trigger conditions, diagnosis queries (ClickHouse SQL), decision tree, remediation delegation, verification queries, and escalation criteria.

| Runbook | Covers | Primary delegate |
|---------|--------|-----------------|
| oomkill | OOMKilled pods | k8s-agent |
| helm_failure | Failed Helm releases | helm-agent |
| restaction_failure | Endpoint-missing, unreachable, auth-failed, bad-jq, broken-dependency | krateo-restaction-agent |
| widget_failure | Widget-missing-restaction, template-error, schema-validation | krateo-portal-agent |
| composition_failure | Chart fetch, Helm render, admission, schema generation failures | krateo-blueprint-agent |
| infra_self_healing | OTel/ClickHouse/MCP/HyperDX/Slack-bot outages (P1) | k8s-agent |
| rbac_denied | Silent widget RBAC failures (S17/S21/S23/S24) + proactive SA scan | k8s-agent |
| security_jwt_egress | JWT leaked to external URLs via nil endpointRef (P0 SECURITY) + proactive scan | krateo-restaction-agent |
| snowplow_panic | Runtime panic / concurrent map write regression | krateo-code-analysis-agent |
| snowplow_bootstrap | Snowplow startup failures (redis, env, SA) | k8s-agent |

---

## Adoption Flow (Help Mode)

```
1. User in Slack: "How do I create a portal page with a button?"
2. a2a-slack-bot → krateo-autopilot
3. Autopilot classifies as portal/widget question → delegates to krateo-portal-agent
4. Portal agent has knowledge loaded:
   - portal_guide: widget anatomy, widgetDataTemplate, resourcesRefs, actions
   - widget_quick_reference: Button, Panel, Page, Route, Form, DataGrid schemas
   - guide_simple_page + guide_action_button: step-by-step tutorials
5. Agent responds with correct YAML examples, field names, and wiring instructions
6. Response flows back: portal-agent → autopilot → slack-bot → Slack thread
```

### Specialist knowledge per agent

| Agent | Knowledge sources | Can help with |
|-------|-------------------|---------------|
| **krateo-portal-agent** | Widget API reference, portal guide, form docs, simple-page guide, action-button guide | Creating pages, panels, buttons, forms, DataGrids, routes, navigation, widgetDataTemplate |
| **krateo-restaction-agent** | Portal guide (RESTAction section), widget reference | Configuring RESTActions, endpointRef Secrets, jq filters, dependsOn chains |
| **krateo-blueprint-agent** | Portal guide, widget reference | Creating CompositionDefinitions, chart scaffolding, composition lifecycle |
| **krateo-auth-agent** | Portal guide | Auth strategies (basic, LDAP, OIDC, social), user/group management |
| **krateo-documentation-agent** | (prompt knowledge only) | Krateo architecture, concepts, terminology |

---

## Guardrails

All 10 sub-agents load the `krateo-agent-guardrails` ConfigMap via `promptTemplate.dataSources`. Active guardrails:

| Guardrail | Prevents | Enforcement |
|-----------|----------|-------------|
| **DATA_SUFFICIENCY** | LLM confabulation on empty data (Bug 5: agent inferred from pod name, not evidence) | Agent must declare `sufficient`/`insufficient` before diagnosing. Empty tool responses → `ROOT_CAUSE: unknown` |
| **EMPTY SUB-AGENT RESPONSE** | Silent acceptance of `{'result': ''}` from streaming bug regression (Bug 2) | Agent must flag empty A2A results as communication issues, retry once |
| **BARE-POD PREFLIGHT** | Deleting bare pods that immediately restart (Bug 3) | k8s-agent checks `ownerReferences` before `delete_pod`. Bare pods → escalate |
| **ESCALATION TIMEOUT** | Hanging `ask_user` threads with no human response (Bug 3 follow-up) | 15-minute cap, then `ESCALATION_TIMEOUT` + close |

---

## Observability Pipeline

The agent chain depends on a working observability pipeline. The pipeline is independent of the agents — it runs whether agents are active or not.

```
K8s workloads (all namespaces)
  ↓ stdout/stderr
OTel DaemonSet (filelog + hostmetrics + kubeletstats)
  ↓ enriches pod logs with krateo.io/composition-id via k8sattributes
  ↓
OTel Deployment (k8sobjects watch + k8s_cluster)
  ↓ enriches K8s events with krateo.io/composition-id via compositionresolver
  ↓
ClickHouse (otel_logs, otel_metrics_gauge, otel_metrics_sum, otel_metrics_histogram)
  ↓
HyperDX (polls every 1min, fires webhooks)
  ↓
Slack → a2a-slack-bot → krateo-autopilot → agent chain
```

### ClickHouse tables

| Table | Content | Primary key |
|-------|---------|-------------|
| `otel_logs` | Pod logs + K8s events (Body as JSON) | `(ServiceName, TimestampTime)` |
| `otel_metrics_gauge` | CPU utilization, memory working set, etc. | `(ServiceName, TimeUnix)` |
| `otel_metrics_sum` | Container restarts, network bytes | `(ServiceName, TimeUnix)` |
| `otel_metrics_histogram` | Request latency distributions | `(ServiceName, TimeUnix)` |
| `otel_traces` | Distributed traces + agent execution traces (kagent v0.8.4) | `(ServiceName, TimeUnix)` |

### Self-monitoring

| Component | Mechanism |
|-----------|-----------|
| Heartbeat canary | CronJob writes JSON log every minute → OTel DaemonSet → ClickHouse. Absence = pipeline broken. |
| PodDisruptionBudgets | SSE proxy, MCP server, OTel deployment — prevent voluntary eviction |
| NetworkPolicies | ClickHouse ingress restricted to OTel, SSE proxy, MCP. MCP ingress restricted to krateo-system. |

---

## Overrides (post-deploy patches)

All customizations are applied via `kagent-overrides/apply-overrides.sh` after any kagent reconcile. The script:

1. Patches `krateo-prompts-eng` ConfigMap with 7 updated prompts (autopilot, sre, observability, portal, restaction, blueprint, auth)
2. Deploys `krateo-agent-guardrails` ConfigMap and wires into all sub-agents
3. Deploys `krateo-portal-knowledge` ConfigMap and wires into 4 specialist agents
4. Deploys `krateo-runbooks` ConfigMap (10 runbooks) and wires into SRE agent
5. Sets `stream: false` on all 13 sub-agents
6. Restarts all agent deployments

```bash
# After any kagent redeploy:
./kagent-overrides/apply-overrides.sh
```
