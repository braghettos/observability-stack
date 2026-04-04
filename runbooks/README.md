# Krateo Runbooks

Structured runbooks that the `krateo-sre-agent` uses to handle known incident
classes deterministically.

## How they work (kagent-native pattern)

1. Each runbook is a markdown file in `markdown/<name>.md`.
2. `apply-overrides.sh` packs them into a `krateo-runbooks` ConfigMap in the
   `krateo-system` namespace.
3. The `krateo-sre-agent` Agent CRD has a second `dataSource` entry pointing
   at that ConfigMap with alias `runbooks`.
4. The SRE agent's system prompt (in `krateo-prompts-eng.sre_agent`) embeds
   each runbook via `{{include "runbooks/<name>"}}` — the inclusion happens at
   agent-load time by the kagent template engine.
5. When an alert arrives, the SRE agent already has all runbooks in its
   system prompt and matches the trigger to pick the right playbook.

This uses kagent's existing `promptTemplate.dataSources` mechanism — no
custom loader, no runtime tool calls, no extra services.

## Runbooks

| Name | Trigger | Primary sub-agent |
|------|---------|-------------------|
| `oomkill` | `reason=OOMKilling` events | k8s-agent |
| `helm_failure` | Helm release failure / image pull errors | helm-agent |
| `restaction_failure` | `endpoint-missing`, `endpoint-unreachable`, `bad-jq-filter`, `broken-dependency` | krateo-restaction-agent |
| `widget_failure` | `widget-missing-restaction`, `widget-template-error`, `widget-error-generic` | krateo-portal-agent |
| `composition_failure` | CompositionDefinition/Composition reconcile errors | krateo-blueprint-agent |
| `infra_self_healing` | Observability stack components down | k8s-agent (P1) |

## Adding a new runbook

1. Write `markdown/<name>.md` following the structure: Trigger, Severity,
   Diagnosis, Decision Tree, Remediation, Verification, Escalation.
2. Add the file to the `kubectl create configmap` in `apply-overrides.sh`.
3. Add `{{include "runbooks/<name>"}}` to `kagent-overrides/prompts/sre_agent.md`.
4. Run `./kagent-overrides/apply-overrides.sh` to deploy.
