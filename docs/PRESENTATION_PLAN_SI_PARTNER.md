# Krateo PlatformOps — Presentation Plan for System Integrator Partners

**Target audience:** System integrator / consultancy company evaluating Krateo as a platform for accelerating delivery projects.

**Key message:** Krateo gives your delivery teams a reusable, agent-assisted platform that turns every new project into a repeatable engagement — reducing ramp-up time, increasing margins, and enabling your consultants to deliver at scale.

---

## Slide Plan (26 slides)

### Slide 1 — Title
**Agentic Operations with Krateo PlatformOps**
Subtitle: *AI-Powered Platform Engineering for System Integrators*
Logo: krateo.io

### Slide 2 — Krateo PlatformOps
**The universal orchestrator backed by Kubernetes.**
- Any resource with an API becomes manageable: VMs, databases, AI agents, legacy systems
- Declarative, GitOps-native, operator-driven
- *For System Integrators & Consultancy Partners*

### Slide 3 — The Delivery Challenge for System Integrators
**Every new client project starts from scratch. Integration knowledge walks out the door.**

| Pain point | Impact |
|-----------|--------|
| **Tribal knowledge** | Senior consultants carry integration patterns in their heads. Onboarding new team members takes weeks. |
| **Project-specific tooling** | Each engagement builds custom scripts, pipelines, and dashboards. Nothing is reusable. |
| **Inconsistent delivery** | Quality depends on who's assigned. No standardized platform across clients. |
| **Slow time-to-value** | Weeks of setup before delivering business value. Clients pay for infrastructure, not outcomes. |
| **Margin pressure** | Senior expertise needed for every project. Can't scale without hiring proportionally. |

### Slide 4 — How Krateo Works
**What is an Operator?**
Think of a thermostat: you set 22°C, and it continuously adjusts to match. An Operator does the same for any resource that exposes an API — VMs, pods, databases, agentic AI, legacy systems. You describe what you want, and it keeps everything running.

Three steps:
1. **Describe** — "I want a database, 3 replicas, on Azure, with daily backups" → YAML CR
2. **Automate** — Operator reconciles the desired state continuously
3. **Observe** — AI agents monitor, diagnose, and remediate issues autonomously

### Slide 5 — Krateo PlatformOps Components
**A complete platform engineering stack — modular, extensible, Kubernetes-native.**

| Component | Role |
|-----------|------|
| **Composable Portal** | Self-service UI built from widget CRDs. Every page, button, form, and data table is a Kubernetes resource. Fully customizable per client. |
| **Snowplow** | API gateway that resolves RESTAction CRDs — connects the Portal to any backend (K8s API, external APIs, cloud providers). |
| **Composition Engine** | Helm-based blueprints (CompositionDefinitions) that provision entire application stacks with one click. |
| **Core Provider** | Manages CompositionDefinition lifecycle: chart fetch, CRD generation, schema validation. |
| **Authentication** | AuthN service supporting basic auth, LDAP, OIDC, OAuth 2.0 — configurable per client. |
| **Providers** | Extensible operator ecosystem: Helm, GitHub, Git, FinOps, OASGen, and any Terraform provider via auto-translation. |
| **AI Agents (kagent)** | 14 specialized agents for platform operations, troubleshooting, and adoption guidance. |
| **Observability Stack** | OTel → ClickHouse → HyperDX → agent alerting pipeline with closed-loop remediation. |

### Slide 6 — The Krateo Agent Ecosystem
**14 AI agents, each a Kubernetes-native specialist.**

| Tier | Agent | What it does |
|------|-------|-------------|
| **Orchestrator** | Krateo Autopilot | Routes user requests to the right specialist. Entry point from Slack. |
| **Incident Response** | SRE Agent | Alert triage, runbook execution, closed-loop remediation with verification. 10 runbooks. |
| | Observability Agent | Queries ClickHouse (logs, events, metrics, traces) for diagnosis. |
| | k8s Agent | 20 Kubernetes operations: get, describe, patch, delete, apply, exec, scale, rollout. |
| | Helm Agent | Helm release management: list, get, upgrade, rollback, uninstall. |
| **Domain Specialists** | Blueprint Agent | Creates CompositionDefinitions, manages compositions, scaffolds Helm charts. |
| | Portal Agent | Generates widget CRDs, configures pages, forms, buttons, data tables. |
| | RESTAction Agent | Configures REST API integrations: endpoints, jq filters, dependency chains. |
| | Auth Agent | Sets up authentication: LDAP, OIDC, OAuth, social login. |
| | Documentation Agent | Answers questions about Krateo architecture and concepts. |
| | Code Analysis Agent | Traces errors to GitHub source, searches code, checks commits. |
| **Migration** | Ansible→Operator | Converts Ansible playbooks to K8s operators. |
| | Terraform→Operator | Translates Terraform providers to K8s operators. |
| | Terraform→Helm | Converts Terraform modules to Helm charts. |

**All agents include guardrails:** data sufficiency checks, bare-pod preflight, escalation timeout, empty-response handling.

### Slide 7 — Agent Capabilities in Detail

**Adoption mode** — agents guide your consultants:
- "How do I create a blueprint for this client?" → Blueprint Agent provides YAML scaffolding
- "How do I add a monitoring dashboard widget?" → Portal Agent returns the exact DataGrid CRD
- "How do I connect this RESTAction to an external API?" → RESTAction Agent shows endpointRef setup

**Troubleshooting mode** — agents resolve issues autonomously:
- Pod crashes → SRE Agent follows OOMKill runbook → k8s Agent patches resource limits → verification
- Widget shows no data → SRE Agent follows Widget Failure runbook → RBAC check → fix applied
- Helm release failed → SRE Agent follows Helm Failure runbook → Helm Agent rollback → verified

**Security mode** — proactive scans embedded in runbooks:
- JWT egress scan: detects RESTActions leaking user tokens to external URLs
- RBAC audit: verifies Snowplow SA has correct permissions for all widgets

### Slide 8 — Advantages for System Integrators

**Why Krateo accelerates your delivery business:**

| Advantage | How |
|-----------|-----|
| **Faster project kickoff** | Pre-built blueprints + agent-guided setup. New client environment in hours, not weeks. |
| **Reusable delivery patterns** | Every integration becomes a CompositionDefinition. Package once, deploy to every client. |
| **Junior consultants deliver senior quality** | AI agents guide them through blueprint creation, widget configuration, and troubleshooting. |
| **Lower cost of operations** | Automated alerting + AI remediation. One SRE covers what used to require 3. |
| **Consistent delivery across clients** | Same platform, same blueprints, same agent-assisted workflow. Quality doesn't depend on who's assigned. |
| **New revenue streams** | Offer "Krateo-as-a-Service" managed platform to clients. Recurring revenue from operations, not just project delivery. |
| **IP retention** | Integration patterns live in Git as CRDs, not in consultants' heads. Knowledge stays when people leave. |
| **Multi-cloud, multi-client** | One platform that orchestrates AWS, Azure, GCP, on-prem. Scale across your entire client portfolio. |

### Slide 9 — Declarative Everything
**Every resource in Krateo is a Kubernetes Custom Resource.**
- Described as YAML, versioned in Git, reconciled by operators
- K8s CRDs for: Infrastructure, Applications, Databases, AI Agents, Portal Pages, REST APIs, Auth, FinOps

### Slide 10 — The Perfect Harness for Agents
**Declarative resources are machine-readable by design.**
- Agents don't need to learn imperative APIs — they read and write YAML
- What agents can do: read cluster state, query observability data, apply manifests, manage Helm releases, open PRs, configure auth

### Slide 11 — End-to-End Alert Pipeline Architecture
*(Keep existing architecture diagram)*
K8s Cluster → OTel Collectors → ClickHouse → HyperDX → Slack → KAgent → Autopilot → SRE → sub-agents → remediation → verification

### Slide 12 — Closed-Loop Remediation
**Alert → Diagnose → Remediate → Verify → Report**
```
Alert fires (HyperDX → Slack → @KAgent)
  ↓ DIAGNOSE: Observability Agent queries ClickHouse
  ↓ CLASSIFY: MANIFEST_ERROR / INFRASTRUCTURE / APP_BUG / TRANSIENT / FALSE_POSITIVE
  ↓ REMEDIATE: k8s-agent / helm-agent / code-analysis-agent
  ↓ VERIFY: Observability Agent re-queries after 60s
  ↓ REPORT: ✅ Resolved or ❌ Escalate to human
```
10 runbooks covering: OOMKill, Helm failure, RESTAction errors, Widget errors, Composition failures, RBAC issues, JWT security, Snowplow panics, infrastructure self-healing.

### Slides 13-18 — Demo Scenarios
*(Keep existing Scenario 1 + 2 + 3 slides)*
- Scenario 1: Pod CrashLoop → Alert → SRE investigates → k8s-agent remediates
- Scenario 2: Broken Blueprint → Error logs → SRE investigates → Root cause identified
- Scenario 3: Autonomous PR Fix → SRE → Code Analysis → GitHub PR opened

### Slide 19 — Knowledge System (kagent-native)
**Agents learn from structured knowledge — no retraining required.**

| Knowledge source | Format | Content |
|-----------------|--------|---------|
| System prompts | ConfigMap (`krateo-prompts-eng`) | 12 agent-specific prompts |
| Runbooks | ConfigMap (`krateo-runbooks`) | 10 incident response playbooks with ClickHouse SQL |
| Portal reference | ConfigMap (`krateo-portal-knowledge`) | Widget API, forms, guides, action patterns |
| Guardrails | ConfigMap (`krateo-agent-guardrails`) | Data sufficiency, bare-pod preflight, escalation timeout |

All loaded via kagent's `promptTemplate.dataSources` — update a ConfigMap, restart the agent, new knowledge is live.

### Slide 20 — Engagement Model for SI Partners

**Phase 1 — Platform Setup (Week 1)**
- Deploy Krateo on client's K8s cluster
- Configure auth (LDAP/OIDC/social)
- Deploy observability stack (OTel → ClickHouse → agents)

**Phase 2 — Blueprint Development (Weeks 2-3)**
- Create client-specific CompositionDefinitions (agent-assisted)
- Configure Portal pages with widgets (agent-assisted)
- Set up RESTActions for client's APIs

**Phase 3 — Handover + Managed Operations**
- Train client team (agents assist with onboarding questions)
- Enable alerting pipeline for autonomous issue detection
- Offer ongoing managed service (SRE agents handle L1/L2)

### Slide 21 — ROI for System Integrators

| Metric | Without Krateo | With Krateo |
|--------|---------------|-------------|
| Project kickoff time | 2-4 weeks | 2-3 days |
| Senior consultant dependency | Every project | First project only (blueprints reused) |
| L1/L2 incident response | Manual, 24/7 team | Automated via agent chain |
| Knowledge retention after project | 20% (tribal) | 100% (Git + CRDs + runbooks) |
| Time to onboard new consultant | 3-4 weeks | 1 week (agent-guided) |
| Cross-client reusability | 0% (bespoke per project) | 80%+ (shared blueprints + operators) |

### Slide 22 — The Future of Krateo
**A platform that self-evolves.**
- Proactive Autopilot: monitors, asks questions, suggests improvements
- Process Ingestion: feed runbooks, the agents learn new workflows
- Migration Agents: convert Ansible, Terraform, legacy scripts to K8s operators

### Slide 23 — Security & Compliance
- All agents run in-cluster, no data leaves the K8s boundary
- RBAC-enforced per-user, per-namespace
- Guardrails prevent autonomous destructive actions
- Audit trail via ClickHouse agent traces (who did what, when)
- JWT egress scanning prevents credential leakage

### Slide 24 — Technology Stack
| Layer | Technology |
|-------|-----------|
| Orchestration | Kubernetes + Helm + GitOps |
| AI Agents | kagent v0.8.6 (Gemini 2.5 Flash/Pro) |
| Agent Protocol | A2A (Agent-to-Agent) v0.3.13 |
| Tools | MCP (Model Context Protocol) — 5 tool servers |
| Observability | OpenTelemetry → ClickHouse → HyperDX |
| Frontend | React + Vite (Composable Portal) |
| Auth | LDAP, OIDC, OAuth 2.0, Social |

### Slide 25 — Getting Started
**Three paths to partner with Krateo:**

1. **Evaluate** — Deploy on a test cluster, try the agent chain, build a blueprint
2. **Pilot** — First client project with Krateo. Krateo team supports setup.
3. **Scale** — Roll out across your client portfolio. Build your own blueprint library.

### Slide 26 — Summary
**Key Takeaway:** Krateo PlatformOps gives system integrators a reusable, agent-powered platform that turns every new delivery project into a repeatable, high-margin engagement. Your consultants deliver faster, your knowledge stays in the platform, and your AI agents handle the operational overhead.

*krateo.io*
