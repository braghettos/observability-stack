# Krateo ClickHouse Kubernetes Observability Stack

Replaces the `eventrouter` + `eventsse` + `etcd` stack with a ClickHouse-based observability pipeline that collects **Kubernetes events, pod logs, traces, and metrics** via OpenTelemetry.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Kubernetes Cluster                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ OpenTelemetry Collectors                                │   │
│  │   DaemonSet  → pod logs, node metrics, kubelet metrics  │   │
│  │   Deployment → K8s events, cluster metrics              │   │
│  │   App Pods   → traces (OTLP)                            │   │
│  └────────────────────┬────────────────────────────────────┘   │
│                       │ OTLP/HTTP :4318                         │
│  ┌────────────────────▼────────────────────────────────────┐   │
│  │ ClickStack (ClickHouse + OTel Gateway + HyperDX)        │   │
│  │   otel_logs     ← pod logs + K8s events                 │   │
│  │   otel_traces   ← application traces                    │   │
│  │   otel_metrics* ← node, cluster, app metrics            │   │
│  └──────────┬──────────────────────────────────────────────┘   │
│             │                                                   │
│    ┌────────┴──────────────────────────────────┐               │
│    │ predefined_query_handler                  │               │
│    │  GET /events/{compositionId}              │               │
│    │  → returns SSEK8sEvent rows (FORMAT JSON) │               │
│    └────────┬──────────────────────────────────┘               │
│             │                  │ poll every 3s                  │
│    ┌────────▼─────────┐  ┌────▼────────────────────────────┐   │
│    │ Krateo RESTAction│  │ krateo-sse-proxy                │   │
│    │ (initial events) │  │  /notifications/ – SSE push     │   │
│    └──────────────────┘  └────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ClickHouse MCP Server                                    │  │
│  │  list_databases / list_tables / run_select_query         │  │
│  │  → connects any MCP-compatible AI agent to ClickHouse    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Layout

```
clickhouse-observability/
├── clickstack/
│   └── values.yaml               # ClickStack Helm values
├── otel-collectors/
│   ├── daemonset.yaml            # OTel DaemonSet (logs + node metrics)
│   └── deployment.yaml           # OTel Deployment (K8s events + cluster metrics)
├── clickhouse-config/
│   ├── http-handlers.xml         # ClickHouse predefined_query_handler config
│   ├── configmap.yaml            # ConfigMap wrapping the XML (applied to cluster)
│   └── endpoint-secret.yaml      # Krateo endpointRef Secret for ClickHouse HTTP
├── sse-proxy/
│   ├── main.go                   # Thin SSE proxy – standard library only
│   ├── go.mod
│   ├── Dockerfile
│   └── deploy/
│       └── deployment.yaml       # K8s Deployment + Service for SSE proxy
├── mcp-server/
│   └── deployment.yaml           # ClickHouse MCP Server Deployment + Service
├── blueprint-templates/
│   ├── restaction.composition-events.yaml          # Updated RESTAction template
│   └── eventlist.composition-events-panel-eventlist.yaml  # EventList (unchanged)
├── install.sh                    # End-to-end install script
└── README.md
```

## Prerequisites

- `kubectl` pointing at the target cluster
- `helm` v3+
- Docker (for building `krateo-sse-proxy` image)
- Kubernetes ≥ 1.24

## Quick Start

```bash
# The SSE proxy image is built and pushed automatically via GitHub Actions
# (.github/workflows/sse-proxy.yaml) on every push to main.
# Image: ghcr.io/braghettos/krateo-sse-proxy:<git-sha>

# Run the full install (uses the latest image tag by default)
chmod +x install.sh
./install.sh
```

## Step-by-Step Install

### Phase 1 – ClickStack

```bash
helm repo add clickstack https://clickhouse.github.io/ClickStack-helm-charts
helm repo update
helm install krateo-clickstack clickstack/clickstack \
  --namespace clickhouse-system --create-namespace \
  -f clickstack/values.yaml
```

### Phase 2 – ClickHouse HTTP Handler Config

The ConfigMap mounts `http-handlers.xml` into `/etc/clickhouse-server/config.d/`
inside the ClickHouse pod. The `extraVolumeMounts` in `clickstack/values.yaml`
wire this up. Apply the ConfigMap **before** the ClickStack install (or trigger
a pod restart after):

```bash
kubectl apply -f clickhouse-config/configmap.yaml -n clickhouse-system
# restart ClickHouse to pick up the new config:
kubectl rollout restart statefulset -n clickhouse-system -l app.kubernetes.io/name=clickhouse
```

This exposes:
```
GET http://krateo-clickstack-clickhouse.clickhouse-system.svc:8123/events/{compositionId}
```

### Phase 3 – OTel Collectors

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts

# Node-level logs + metrics
helm install otel-daemonset open-telemetry/opentelemetry-collector \
  -f otel-collectors/daemonset.yaml -n clickhouse-system

# K8s events + cluster metrics
helm install otel-deployment open-telemetry/opentelemetry-collector \
  -f otel-collectors/deployment.yaml -n clickhouse-system
```

> **Label your Krateo compositions.** The OTel `kubernetesEvents` receiver propagates
> the `krateo.composition.id` label from the involved object to the log record's
> `ResourceAttributes['krateo.composition.id']`. Ensure compositions add this label
> to the resources they create.

### Phase 4 – Krateo Endpoint Secret

```bash
kubectl apply -f clickhouse-config/endpoint-secret.yaml -n krateo-system
```

### Phase 5 – SSE Proxy

```bash
kubectl apply -f sse-proxy/deploy/deployment.yaml
```

**Update the Krateo frontend `config.json`:**
```json
{
  "api": {
    "EVENTS_API_BASE_URL":      "http://krateo-clickstack-clickhouse.clickhouse-system.svc:8123",
    "EVENTS_PUSH_API_BASE_URL": "http://krateo-sse-proxy.krateo-system.svc:8080"
  }
}
```

### Phase 6 – ClickHouse MCP Server

```bash
kubectl apply -f mcp-server/deployment.yaml
```

**Access from Cursor (local):**
```bash
kubectl port-forward svc/clickhouse-mcp-server 8000:8000 -n krateo-system
```

Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "clickhouse-k8s": {
      "url": "http://localhost:8000/mcp"
    }
  }
}
```

## Blueprint Template Changes

Copy the updated templates into the `portal-composition-page-generic` chart:

| File | Change |
|------|--------|
| `restaction.composition-events.yaml` | `endpointRef.name` → `clickhouse-internal-endpoint`; `filter` updated to reshape ClickHouse JSON output into `SSEK8sEvent` list |
| `eventlist.composition-events-panel-eventlist.yaml` | No changes (update `EVENTS_PUSH_API_BASE_URL` in frontend config instead) |

## Validation

### Verify events in ClickHouse
```bash
kubectl exec -it -n clickhouse-system \
  $(kubectl get pod -n clickhouse-system -l app.kubernetes.io/name=clickhouse -o name | head -1) \
  -- clickhouse-client -q \
  "SELECT count(), min(Timestamp), max(Timestamp)
   FROM otel_logs
   WHERE ResourceAttributes['k8s.event.reason'] != ''"
```

### Test the REST endpoint
```bash
# Port-forward ClickHouse HTTP
kubectl port-forward svc/krateo-clickstack-clickhouse 8123:8123 -n clickhouse-system &

# Query events for a compositionId
curl -s "http://localhost:8123/events/my-composition-id" | jq .
```

### Test the SSE proxy
```bash
kubectl port-forward svc/krateo-sse-proxy 8080:8080 -n krateo-system &
curl -N http://localhost:8080/notifications/
# Should see: ": connected" then periodic ": keepalive" comments,
# and "event: <compositionId>\ndata: {...}" when new events arrive.
```

### Test the MCP Server
```bash
kubectl port-forward svc/clickhouse-mcp-server 8000:8000 -n krateo-system &
curl -s http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq .
```

## Troubleshooting Agent Queries

Once the MCP server is connected, an AI agent can run:

```sql
-- Pods with the most errors in the last hour
SELECT ResourceAttributes['k8s.pod.name'] AS pod,
       ResourceAttributes['k8s.namespace.name'] AS ns,
       count() AS errors
FROM otel_logs
WHERE SeverityText IN ('ERROR','FATAL')
  AND Timestamp > now() - INTERVAL 1 HOUR
GROUP BY pod, ns ORDER BY errors DESC LIMIT 10;

-- Correlate K8s events with pod logs
SELECT Timestamp, Body, ResourceAttributes['k8s.event.reason'] AS reason
FROM otel_logs
WHERE ResourceAttributes['k8s.pod.name'] = 'my-failing-pod'
ORDER BY Timestamp DESC LIMIT 50;

-- Slow traces
SELECT TraceId, SpanName, Duration/1e6 AS duration_ms
FROM otel_traces
WHERE ServiceName = 'my-service' AND Duration > 1000000000
ORDER BY Timestamp DESC LIMIT 20;
```
