#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Krateo ClickHouse Observability Stack – installation script
#
# Usage: ./install.sh [--skip-helm] [--namespace <ns>]
#
# Prerequisites:
#   - kubectl configured against the target cluster
#   - helm v3+
#   - Docker (only if building the SSE proxy image yourself)
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CH_NAMESPACE="${CH_NAMESPACE:-clickhouse-system}"
KRATEO_NAMESPACE="${KRATEO_NAMESPACE:-krateo-system}"
SKIP_HELM="${SKIP_HELM:-false}"

log() { echo "[install] $*"; }
die() { echo "[ERROR] $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Phase 0: Prerequisites
# ---------------------------------------------------------------------------
for cmd in kubectl helm; do
  command -v "$cmd" &>/dev/null || die "$cmd is required but not found in PATH"
done

log "Target cluster: $(kubectl config current-context)"
log "ClickHouse namespace: $CH_NAMESPACE"
log "Krateo namespace:     $KRATEO_NAMESPACE"

# ---------------------------------------------------------------------------
# Phase 1: Deploy ClickStack (ClickHouse + OTel Gateway + HyperDX)
# ---------------------------------------------------------------------------
if [[ "$SKIP_HELM" != "true" ]]; then
  log "==> Phase 1: Installing ClickStack..."

  helm repo add clickstack https://clickhouse.github.io/ClickStack-helm-charts 2>/dev/null || true
  helm repo update clickstack

  helm upgrade --install krateo-clickstack clickstack/clickstack \
    --namespace "$CH_NAMESPACE" \
    --create-namespace \
    -f "$SCRIPT_DIR/clickstack/values.yaml" \
    --wait \
    --timeout 10m

  log "ClickStack deployed."
else
  log "Skipping Helm install (SKIP_HELM=true)."
fi

# ---------------------------------------------------------------------------
# Phase 2: Apply ClickHouse HTTP handler ConfigMap (must exist before pod restart)
# ---------------------------------------------------------------------------
log "==> Phase 2: Applying ClickHouse HTTP handler config..."

kubectl apply -f "$SCRIPT_DIR/clickhouse-config/configmap.yaml" \
  --namespace "$CH_NAMESPACE"

# Trigger a rolling restart so the new config.d file is picked up.
# (The volume mount is defined in clickstack/values.yaml extraVolumeMounts.)
kubectl rollout restart statefulset \
  -n "$CH_NAMESPACE" \
  -l app.kubernetes.io/name=clickhouse 2>/dev/null || \
kubectl rollout restart deployment \
  -n "$CH_NAMESPACE" \
  -l app.kubernetes.io/name=clickhouse 2>/dev/null || \
log "Could not restart ClickHouse – restart the ClickHouse pod manually to apply http-handlers config."

log "ClickHouse HTTP handlers configured."

# ---------------------------------------------------------------------------
# Phase 2b: Patch HyperDX service to LoadBalancer
# ---------------------------------------------------------------------------
log "==> Phase 2b: Patching HyperDX service to LoadBalancer..."

# The ClickStack chart does not expose a service.type value for HyperDX,
# so we patch the service after Helm install/upgrade.
kubectl patch svc krateo-clickstack-app \
  -n "$CH_NAMESPACE" \
  -p '{"spec": {"type": "LoadBalancer", "loadBalancerIP": "34.59.191.193"}}'

log "HyperDX service patched to LoadBalancer."
log "    Waiting for external IP (up to 60s)..."
for i in $(seq 1 12); do
  EXT_IP=$(kubectl get svc krateo-clickstack-app -n "$CH_NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null)
  [ -n "$EXT_IP" ] && break
  sleep 5
done
log "    HyperDX UI: http://${EXT_IP:-<pending>}:3000"

# ---------------------------------------------------------------------------
# Phase 3: Deploy OTel collectors
# ---------------------------------------------------------------------------
log "==> Phase 3: Installing OTel collectors..."

helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts 2>/dev/null || true
helm repo update open-telemetry

helm upgrade --install otel-daemonset open-telemetry/opentelemetry-collector \
  --namespace "$CH_NAMESPACE" \
  -f "$SCRIPT_DIR/otel-collectors/daemonset.yaml" \
  --wait \
  --timeout 5m

helm upgrade --install otel-deployment open-telemetry/opentelemetry-collector \
  --namespace "$CH_NAMESPACE" \
  -f "$SCRIPT_DIR/otel-collectors/deployment.yaml" \
  --wait \
  --timeout 5m

log "OTel collectors deployed."

# ---------------------------------------------------------------------------
# Phase 4: Apply Krateo endpointRef Secret for ClickHouse
# ---------------------------------------------------------------------------
log "==> Phase 4: Creating ClickHouse endpoint secret..."

kubectl apply -f "$SCRIPT_DIR/clickhouse-config/endpoint-secret.yaml" \
  --namespace "$KRATEO_NAMESPACE" 2>/dev/null || \
kubectl apply -f "$SCRIPT_DIR/clickhouse-config/endpoint-secret.yaml"

log "ClickHouse endpoint secret created."

# ---------------------------------------------------------------------------
# Phase 5: Deploy SSE proxy
# ---------------------------------------------------------------------------
log "==> Phase 5: Deploying SSE proxy..."

# The SSE proxy image is built and pushed automatically by the GitHub Actions
# workflow at .github/workflows/sse-proxy.yaml on every push to main.
# Image: ghcr.io/braghettos/krateo-sse-proxy:<sha>

kubectl apply -f "$SCRIPT_DIR/sse-proxy/deploy/deployment.yaml"
kubectl rollout status deployment/krateo-sse-proxy \
  -n "$KRATEO_NAMESPACE" --timeout=120s

log "SSE proxy deployed."

# ---------------------------------------------------------------------------
# Phase 6: Deploy ClickHouse MCP Server
# ---------------------------------------------------------------------------
log "==> Phase 6: Deploying ClickHouse MCP Server..."

kubectl apply -f "$SCRIPT_DIR/mcp-server/deployment.yaml"
kubectl rollout status deployment/clickhouse-mcp-server \
  -n "$KRATEO_NAMESPACE" --timeout=120s

log "ClickHouse MCP Server deployed."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<EOF

===========================================================================
Krateo ClickHouse Observability Stack installed successfully.

  ClickHouse HTTP:  http://krateo-clickstack-clickhouse.$CH_NAMESPACE.svc:8123
  OTel Gateway:     http://krateo-clickstack-otel-collector.$CH_NAMESPACE.svc:4318
  HyperDX UI:       kubectl port-forward svc/krateo-clickstack-hyperdx $CH_NAMESPACE 8080:8080
  SSE Proxy:        http://krateo-sse-proxy.$KRATEO_NAMESPACE.svc:8080
  MCP Server:       http://clickhouse-mcp-server.$KRATEO_NAMESPACE.svc:8000/mcp

Next steps:
  1. Update the blueprint templates in krateoplatformops-blueprints/portal-composition-page-generic
     using the files in ./blueprint-templates/
  2. Update the frontend config.json:
       EVENTS_PUSH_API_BASE_URL -> http://krateo-sse-proxy.$KRATEO_NAMESPACE.svc:8080
  3. Verify K8s events appear in ClickHouse:
       kubectl exec -it -n $CH_NAMESPACE svc/krateo-clickstack-clickhouse -- \
         clickhouse-client -q "SELECT count() FROM otel_logs WHERE ResourceAttributes['k8s.event.reason'] != ''"
  4. To use the MCP server in Cursor:
       kubectl port-forward svc/clickhouse-mcp-server 8000:8000 -n $KRATEO_NAMESPACE
       # Add to .cursor/mcp.json: {"mcpServers": {"clickhouse": {"url": "http://localhost:8000/mcp"}}}
===========================================================================
EOF
