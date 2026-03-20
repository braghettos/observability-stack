# Krateo Observability Stack — Architecture

```mermaid
flowchart LR
    classDef krateo fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1
    classDef k8s fill:#e8eaf6,stroke:#3f51b5,stroke-width:2px,color:#1a237e
    classDef otel fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#bf360c
    classDef storage fill:#fce4ec,stroke:#b71c1c,stroke-width:2px,color:#b71c1c
    classDef frontend fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20
    classDef alert fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px,color:#4a148c
    classDef agent fill:#fff8e1,stroke:#f57f17,stroke-width:2px,color:#e65100
    classDef slack fill:#efebe9,stroke:#4e342e,stroke-width:2px,color:#3e2723
    classDef mcp fill:#e0f7fa,stroke:#006064,stroke-width:2px,color:#004d40

    subgraph K8S["Kubernetes Cluster"]
        direction LR

        subgraph KRATEO["Krateo Components"]
            direction TB
            FE_SP["Frontend + Snowplow"]:::krateo
            CDC["Composition Dynamic Ctrl"]:::krateo
            CP["Core Provider"]:::krateo
            AUTH["AuthN / AuthZ"]:::krateo
            PROV["Providers\n(Helm, GitHub, ...)"]:::krateo
        end

        K8SW["Other K8s Workloads\nDeployments, Jobs, CronJobs"]:::k8s

        subgraph OTEL["OTel Collectors"]
            direction TB
            DS["OTel DaemonSet\nfilelog · hostmetrics · kubeletstats\n(per node)"]:::otel
            DEP["OTel Deployment\nk8sobjects · k8s_cluster\ncompositionresolver · cluster-level"]:::otel
            GW["OTel Gateway\nOTLP/HTTP :4318 · ClickStack"]:::otel
        end

        subgraph CH["ClickHouse"]
            direction TB
            LOGS["otel_logs"]:::storage
            TRACES["otel_traces"]:::storage
            METRICS["otel_metrics"]:::storage
            HTTP["/events?composition_id=X"]:::storage
            HDX_DB["HyperDX (MongoDB)\nAlert state · monitoring UI"]:::alert
        end

        subgraph FRONTEND["Krateo Frontend (consumer)"]
            direction TB
            RA["RESTAction\nGET /events"]:::frontend
            EL["EventList\nSSE real-time"]:::frontend
        end

        SSE["krateo-sse-proxy\n:8080\nPolls CH every 3s"]:::frontend

        HDX["HyperDX Alerts\nPod restart detection"]:::alert

        KAGENT["KAgent Slack Bot"]:::slack

        MCP["ClickHouse MCP Server\n:8000\nlist_databases · list_tables\nrun_select_query"]:::mcp

        subgraph AUTOPILOT["Krateo Autopilot"]
            direction TB
            OBS["Observability Agent\ndiagnosis via CH MCP"]:::agent
            K8SA["k8s-agent\nremediation"]:::agent
            HELMA["helm-agent\nHelm ops"]:::agent
        end
    end

    SLACK["Slack\n#krateo-troubleshooting\nEXTERNAL SERVICE"]:::slack

    %% Data flow: Producers → OTel → ClickHouse
    KRATEO -.->|"Logs, Events\nTraces, Metrics"| OTEL
    K8SW -.->|"Logs, Events\nTraces, Metrics"| OTEL
    DS -->|export| LOGS
    DS --> METRICS
    DEP -->|export| LOGS
    DEP --> METRICS
    GW -->|export| TRACES

    %% Frontend consumption
    HTTP -->|REST| RA
    LOGS -->|poll| SSE
    SSE -->|SSE /notifications/| EL

    %% Alerting
    LOGS -->|query 1m| HDX
    HDX -->|webhook| SLACK
    SLACK -->|@mention| KAGENT

    %% AI Agents
    KAGENT -->|routes to| AUTOPILOT
    OBS -->|MCP tools| MCP
    MCP -->|queries| LOGS
    AUTOPILOT -.->|reports back| SLACK
```

## Data Flow Summary

| Signal  | Producer              | Collector        | ClickHouse Table | Consumer                          |
|---------|-----------------------|------------------|------------------|-----------------------------------|
| Logs    | All pods              | OTel DaemonSet   | `otel_logs`      | HyperDX, MCP Server, SSE Proxy   |
| Events  | K8s API (watch)       | OTel Deployment  | `otel_logs`      | Krateo Frontend, HyperDX, Agents  |
| Traces  | Instrumented apps     | OTel Gateway     | `otel_traces`    | HyperDX, MCP Server              |
| Metrics | Nodes, Kubelet, Pods  | OTel DaemonSet + Deployment | `otel_metrics` | HyperDX, MCP Server   |

## Key Integrations

- **Krateo Frontend** consumes events via REST (`/events`) for initial load and SSE (`/notifications/`) for real-time updates
- **HyperDX** monitors ClickHouse and sends alert/resolution webhooks to Slack
- **Krateo Autopilot** is triggered via KAgent Slack bot when alerts @mention it, coordinating observability, k8s, and helm agents
- **Observability Agent** queries ClickHouse through the MCP Server for root-cause diagnosis
- Everything runs inside the **Kubernetes cluster** except Slack (external service)
