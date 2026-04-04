#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Kagent Overrides — Apply post-deploy patches to kagent agents
#
# These fixes are re-applied after any kagent reconcile/redeploy:
#
#   1. Patch krateo-prompts-eng ConfigMap with updated prompts:
#      - autopilot: rename code-remediation → code-analysis (agent exists with this name)
#      - sre_agent: rename code-remediation → code-analysis + add verification loop
#      - observability_agent: add verification mode + composition-id log correlation
#
#   2. Disable streaming on all sub-agents (stream: false):
#      Sub-agents called via A2A with stream:true return empty results to
#      the caller while the sub-agent keeps running async. This causes the
#      Autopilot to respond "delegated, will update later" but never update.
#      Setting stream:false makes sub-agent calls synchronous, returning
#      the full response to the caller. Keep stream:true on krateo-autopilot
#      (user-facing, needs streaming UX).
#
# Usage:
#   ./apply-overrides.sh
#
# Prerequisites:
#   - kubectl with access to the cluster
#   - krateo-prompts-eng ConfigMap exists in krateo-system
#   - kagent Agent CRDs exist in krateo-system
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${KRATEO_NAMESPACE:-krateo-system}"

log() { echo "[override] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }

command -v kubectl &>/dev/null || die "kubectl is required"

# ---------------------------------------------------------------------------
# 1. Patch prompts ConfigMap
# ---------------------------------------------------------------------------
log "Patching krateo-prompts-eng ConfigMap..."

if ! kubectl get configmap krateo-prompts-eng -n "$NS" &>/dev/null; then
  die "ConfigMap krateo-prompts-eng not found in $NS — install kagent first"
fi

PATCH=$(python3 -c "
import json
prompts = {}
for key in ['autopilot', 'sre_agent', 'observability_agent']:
    with open('$SCRIPT_DIR/prompts/' + key + '.md') as f:
        prompts[key] = f.read()
print(json.dumps({'data': prompts}))
")

kubectl patch configmap krateo-prompts-eng -n "$NS" --type merge -p "$PATCH"
log "Prompts updated."

# ---------------------------------------------------------------------------
# 2. Disable streaming on sub-agents (keep Autopilot streaming)
# ---------------------------------------------------------------------------
log "Disabling streaming on sub-agents..."

SUB_AGENTS=(
  krateo-sre-agent
  krateo-observability-agent
  k8s-agent
  helm-agent
  krateo-code-analysis-agent
  krateo-auth-agent
  krateo-blueprint-agent
  krateo-documentation-agent
  krateo-portal-agent
  krateo-restaction-agent
  krateo-ansible-to-operator-agent
  krateo-tf-provider-to-operator-agent
  krateo-tf-to-helm-agent
)

for agent in "${SUB_AGENTS[@]}"; do
  if kubectl get agent "$agent" -n "$NS" &>/dev/null; then
    kubectl patch agent "$agent" -n "$NS" --type=merge \
      -p '{"spec":{"declarative":{"stream":false}}}' 2>&1 | sed "s/^/  /"
  else
    log "  skip: $agent (not found)"
  fi
done

# ---------------------------------------------------------------------------
# 3. Restart affected deployments to pick up new prompts
# ---------------------------------------------------------------------------
log "Restarting agent deployments..."

for deploy in krateo-autopilot krateo-sre-agent krateo-observability-agent "${SUB_AGENTS[@]}"; do
  # Avoid restarting twice (SUB_AGENTS already includes sre + observability)
  :
done

# Deduplicated restart list
RESTART_DEPLOYS=$(printf '%s\n' krateo-autopilot "${SUB_AGENTS[@]}" | sort -u)
for deploy in $RESTART_DEPLOYS; do
  if kubectl get deployment "$deploy" -n "$NS" &>/dev/null; then
    kubectl rollout restart deployment "$deploy" -n "$NS" 2>&1 | sed "s/^/  /"
  fi
done

log "Overrides applied successfully."
log ""
log "Verify with:"
log "  kubectl get agent -n $NS -o custom-columns=NAME:.metadata.name,STREAM:.spec.declarative.stream"
