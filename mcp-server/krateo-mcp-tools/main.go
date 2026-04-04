// Package main implements a Krateo MCP Tools server that provides
// pre-built diagnostic queries as MCP tools. Instead of agents crafting
// raw SQL, they call high-level tools like get_pod_errors or
// get_composition_events.
//
// This server queries ClickHouse directly (HTTP API) and exposes results
// via the MCP protocol (SSE transport).
//
// Tools provided:
//   - get_pod_errors: Recent error logs for a pod
//   - get_pod_timeline: Correlated events + logs + metrics for a pod
//   - get_composition_events: All events for a Krateo composition
//   - get_warning_summary: Summary of Warning events across the cluster
//   - get_agent_traces: Recent agent execution traces
//   - check_pod_health: Combined health check (events, restarts, resource usage)
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type config struct {
	clickhouseURL  string
	clickhouseUser string
	clickhousePass string
	listenAddr     string
}

func loadConfig() config {
	return config{
		clickhouseURL:  getEnv("CLICKHOUSE_URL", "http://krateo-clickstack-clickhouse-clickhouse-headless.clickhouse-system.svc:8123"),
		clickhouseUser: getEnv("CLICKHOUSE_USER", "default"),
		clickhousePass: getEnv("CLICKHOUSE_PASSWORD", ""),
		listenAddr:     getEnv("LISTEN_ADDR", ":8001"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ---------------------------------------------------------------------------
// ClickHouse query helper
// ---------------------------------------------------------------------------

func queryClickHouse(cfg config, sql string) (json.RawMessage, error) {
	u, _ := url.Parse(cfg.clickhouseURL)
	q := u.Query()
	q.Set("query", sql+" FORMAT JSON")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if cfg.clickhouseUser != "" {
		req.SetBasicAuth(cfg.clickhouseUser, cfg.clickhousePass)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("clickhouse request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("clickhouse error (%d): %s", resp.StatusCode, string(body)[:min(len(body), 500)])
	}

	// Extract just the "data" array from ClickHouse JSON response
	var chResp struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &chResp); err != nil {
		return nil, fmt.Errorf("parse response: %w", err)
	}
	return chResp.Data, nil
}

// ---------------------------------------------------------------------------
// MCP Tool definitions
// ---------------------------------------------------------------------------

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

var tools = []mcpTool{
	{
		Name:        "get_pod_errors",
		Description: "Get recent ERROR and FATAL log entries for a specific pod. Returns timestamps, severity, and log body excerpts.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"namespace": map[string]any{"type": "string", "description": "Kubernetes namespace"},
				"pod_name":  map[string]any{"type": "string", "description": "Pod name (prefix match)"},
				"minutes":   map[string]any{"type": "integer", "description": "Look-back window in minutes (default: 30)", "default": 30},
			},
			"required": []string{"namespace", "pod_name"},
		},
	},
	{
		Name:        "get_pod_timeline",
		Description: "Get a correlated timeline of K8s events and error logs for a pod, ordered chronologically. Useful for understanding the sequence of events leading to a failure.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"namespace": map[string]any{"type": "string", "description": "Kubernetes namespace"},
				"pod_name":  map[string]any{"type": "string", "description": "Pod name (prefix match)"},
				"minutes":   map[string]any{"type": "integer", "description": "Look-back window in minutes (default: 60)", "default": 60},
			},
			"required": []string{"namespace", "pod_name"},
		},
	},
	{
		Name:        "get_composition_events",
		Description: "Get all K8s events for resources belonging to a Krateo composition, identified by composition ID (UID).",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"composition_id": map[string]any{"type": "string", "description": "Krateo composition UID (krateo.io/composition-id)"},
				"minutes":        map[string]any{"type": "integer", "description": "Look-back window in minutes (default: 60)", "default": 60},
			},
			"required": []string{"composition_id"},
		},
	},
	{
		Name:        "get_warning_summary",
		Description: "Get a summary of all Warning events across the cluster, grouped by namespace, pod, and reason. Useful for identifying the most active alert sources.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"minutes":   map[string]any{"type": "integer", "description": "Look-back window in minutes (default: 30)", "default": 30},
				"namespace": map[string]any{"type": "string", "description": "Filter by namespace (optional)"},
			},
		},
	},
	{
		Name:        "get_agent_traces",
		Description: "Get recent agent execution traces from otel_traces. Shows agent invocations, tool calls, and their durations. Requires kagent v0.8.4+ with tracing enabled.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"agent_name": map[string]any{"type": "string", "description": "Filter by agent name/service (optional, e.g., 'krateo-autopilot')"},
				"minutes":    map[string]any{"type": "integer", "description": "Look-back window in minutes (default: 60)", "default": 60},
			},
		},
	},
	{
		Name:        "check_pod_health",
		Description: "Comprehensive health check for a pod: recent Warning events, error logs, restart count, and resource utilization. Returns a structured health report.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"namespace": map[string]any{"type": "string", "description": "Kubernetes namespace"},
				"pod_name":  map[string]any{"type": "string", "description": "Pod name (prefix match)"},
			},
			"required": []string{"namespace", "pod_name"},
		},
	},
}

// ---------------------------------------------------------------------------
// Tool execution — each tool maps to a pre-built ClickHouse query
// ---------------------------------------------------------------------------

func executeTool(cfg config, name string, args map[string]any) (json.RawMessage, error) {
	switch name {
	case "get_pod_errors":
		return getPodErrors(cfg, args)
	case "get_pod_timeline":
		return getPodTimeline(cfg, args)
	case "get_composition_events":
		return getCompositionEvents(cfg, args)
	case "get_warning_summary":
		return getWarningSummary(cfg, args)
	case "get_agent_traces":
		return getAgentTraces(cfg, args)
	case "check_pod_health":
		return checkPodHealth(cfg, args)
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}

func getStr(args map[string]any, key, def string) string {
	if v, ok := args[key].(string); ok && v != "" {
		return v
	}
	return def
}

func getInt(args map[string]any, key string, def int) int {
	if v, ok := args[key].(float64); ok {
		return int(v)
	}
	return def
}

func getPodErrors(cfg config, args map[string]any) (json.RawMessage, error) {
	ns := getStr(args, "namespace", "default")
	pod := getStr(args, "pod_name", "")
	mins := getInt(args, "minutes", 30)

	sql := fmt.Sprintf(`
		SELECT toString(Timestamp) AS timestamp,
		       SeverityText AS severity,
		       substring(Body, 1, 500) AS body,
		       ResourceAttributes['k8s.pod.name'] AS pod_name,
		       ResourceAttributes['k8s.container.name'] AS container
		FROM otel_logs
		WHERE ResourceAttributes['k8s.pod.name'] LIKE '%s%%'
		  AND ResourceAttributes['k8s.namespace.name'] = '%s'
		  AND SeverityText IN ('ERROR', 'FATAL')
		  AND Timestamp > now() - INTERVAL %d MINUTE
		ORDER BY Timestamp DESC LIMIT 30`, pod, ns, mins)

	return queryClickHouse(cfg, sql)
}

func getPodTimeline(cfg config, args map[string]any) (json.RawMessage, error) {
	ns := getStr(args, "namespace", "default")
	pod := getStr(args, "pod_name", "")
	mins := getInt(args, "minutes", 60)

	sql := fmt.Sprintf(`
		SELECT toString(Timestamp) AS timestamp,
		       'event' AS source,
		       JSONExtractString(Body, 'object', 'reason') AS reason,
		       JSONExtractString(Body, 'object', 'message') AS message,
		       JSONExtractString(Body, 'object', 'type') AS type
		FROM otel_logs
		WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
		  AND JSONExtractString(Body, 'object', 'involvedObject', 'name') LIKE '%s%%'
		  AND JSONExtractString(Body, 'object', 'involvedObject', 'namespace') = '%s'
		  AND Timestamp > now() - INTERVAL %d MINUTE
		UNION ALL
		SELECT toString(Timestamp) AS timestamp,
		       'log' AS source,
		       SeverityText AS reason,
		       substring(Body, 1, 300) AS message,
		       '' AS type
		FROM otel_logs
		WHERE ResourceAttributes['k8s.pod.name'] LIKE '%s%%'
		  AND ResourceAttributes['k8s.namespace.name'] = '%s'
		  AND SeverityText IN ('ERROR', 'FATAL', 'WARN')
		  AND ResourceAttributes['telemetry.source'] != 'k8s-events'
		  AND Timestamp > now() - INTERVAL %d MINUTE
		ORDER BY timestamp DESC LIMIT 50`, pod, ns, mins, pod, ns, mins)

	return queryClickHouse(cfg, sql)
}

func getCompositionEvents(cfg config, args map[string]any) (json.RawMessage, error) {
	compID := getStr(args, "composition_id", "")
	mins := getInt(args, "minutes", 60)

	sql := fmt.Sprintf(`
		SELECT toString(Timestamp) AS timestamp,
		       JSONExtractString(Body, 'object', 'involvedObject', 'kind') AS kind,
		       JSONExtractString(Body, 'object', 'involvedObject', 'name') AS name,
		       JSONExtractString(Body, 'object', 'involvedObject', 'namespace') AS namespace,
		       JSONExtractString(Body, 'object', 'reason') AS reason,
		       JSONExtractString(Body, 'object', 'message') AS message,
		       JSONExtractString(Body, 'object', 'type') AS type
		FROM otel_logs
		WHERE LogAttributes['krateo.io/composition-id'] = '%s'
		  AND ResourceAttributes['telemetry.source'] = 'k8s-events'
		  AND Timestamp > now() - INTERVAL %d MINUTE
		ORDER BY Timestamp DESC LIMIT 50`, compID, mins)

	return queryClickHouse(cfg, sql)
}

func getWarningSummary(cfg config, args map[string]any) (json.RawMessage, error) {
	mins := getInt(args, "minutes", 30)
	ns := getStr(args, "namespace", "")

	nsFilter := ""
	if ns != "" {
		nsFilter = fmt.Sprintf("AND JSONExtractString(Body, 'object', 'involvedObject', 'namespace') = '%s'", ns)
	}

	sql := fmt.Sprintf(`
		SELECT JSONExtractString(Body, 'object', 'involvedObject', 'namespace') AS namespace,
		       JSONExtractString(Body, 'object', 'involvedObject', 'name') AS resource,
		       JSONExtractString(Body, 'object', 'involvedObject', 'kind') AS kind,
		       JSONExtractString(Body, 'object', 'reason') AS reason,
		       count() AS event_count,
		       max(toString(Timestamp)) AS last_seen
		FROM otel_logs
		WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
		  AND JSONExtractString(Body, 'object', 'type') = 'Warning'
		  %s
		  AND Timestamp > now() - INTERVAL %d MINUTE
		GROUP BY namespace, resource, kind, reason
		ORDER BY event_count DESC LIMIT 30`, nsFilter, mins)

	return queryClickHouse(cfg, sql)
}

func getAgentTraces(cfg config, args map[string]any) (json.RawMessage, error) {
	agent := getStr(args, "agent_name", "")
	mins := getInt(args, "minutes", 60)

	serviceFilter := "AND ServiceName LIKE 'krateo-%'"
	if agent != "" {
		serviceFilter = fmt.Sprintf("AND ServiceName = '%s'", agent)
	}

	sql := fmt.Sprintf(`
		SELECT TraceId AS trace_id,
		       SpanName AS span_name,
		       ServiceName AS service_name,
		       Duration / 1000000 AS duration_ms,
		       StatusCode AS status_code,
		       toString(Timestamp) AS timestamp
		FROM otel_traces
		WHERE Timestamp > now() - INTERVAL %d MINUTE
		  %s
		ORDER BY Timestamp DESC LIMIT 30`, mins, serviceFilter)

	return queryClickHouse(cfg, sql)
}

func checkPodHealth(cfg config, args map[string]any) (json.RawMessage, error) {
	ns := getStr(args, "namespace", "default")
	pod := getStr(args, "pod_name", "")

	// Multi-query: warning events + error logs + metrics
	warningSQL := fmt.Sprintf(`
		SELECT JSONExtractString(Body, 'object', 'reason') AS reason,
		       count() AS count,
		       max(toString(Timestamp)) AS last_seen
		FROM otel_logs
		WHERE ResourceAttributes['telemetry.source'] = 'k8s-events'
		  AND JSONExtractString(Body, 'object', 'type') = 'Warning'
		  AND JSONExtractString(Body, 'object', 'involvedObject', 'name') LIKE '%s%%'
		  AND JSONExtractString(Body, 'object', 'involvedObject', 'namespace') = '%s'
		  AND Timestamp > now() - INTERVAL 60 MINUTE
		GROUP BY reason ORDER BY count DESC`, pod, ns)

	warnings, err := queryClickHouse(cfg, warningSQL)
	if err != nil {
		warnings = json.RawMessage("[]")
	}

	errorSQL := fmt.Sprintf(`
		SELECT count() AS error_count
		FROM otel_logs
		WHERE ResourceAttributes['k8s.pod.name'] LIKE '%s%%'
		  AND ResourceAttributes['k8s.namespace.name'] = '%s'
		  AND SeverityText IN ('ERROR', 'FATAL')
		  AND Timestamp > now() - INTERVAL 60 MINUTE`, pod, ns)

	errors, err := queryClickHouse(cfg, errorSQL)
	if err != nil {
		errors = json.RawMessage(`[{"error_count": "unknown"}]`)
	}

	report := fmt.Sprintf(`[{"pod": "%s", "namespace": "%s", "warning_events": %s, "error_logs": %s}]`,
		pod, ns, string(warnings), string(errors))

	return json.RawMessage(report), nil
}

// ---------------------------------------------------------------------------
// MCP Protocol handlers (simplified SSE transport)
// ---------------------------------------------------------------------------

// handleMCP implements a minimal MCP server over SSE.
// Handles: initialize, tools/list, tools/call
func handleMCP(cfg config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			// SSE endpoint for MCP
			handleMCPSSE(cfg, w, r)
			return
		}

		// POST — JSON-RPC request
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read error", http.StatusBadRequest)
			return
		}

		var req struct {
			JSONRPC string         `json:"jsonrpc"`
			ID      any            `json:"id"`
			Method  string         `json:"method"`
			Params  map[string]any `json:"params"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "invalid JSON-RPC", http.StatusBadRequest)
			return
		}

		var result any

		switch req.Method {
		case "initialize":
			result = map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "krateo-mcp-tools", "version": "0.1.0"},
			}

		case "tools/list":
			result = map[string]any{"tools": tools}

		case "tools/call":
			toolName, _ := req.Params["name"].(string)
			toolArgs, _ := req.Params["arguments"].(map[string]any)

			data, err := executeTool(cfg, toolName, toolArgs)
			if err != nil {
				result = map[string]any{
					"content": []map[string]any{
						{"type": "text", "text": fmt.Sprintf("Error: %v", err)},
					},
					"isError": true,
				}
			} else {
				result = map[string]any{
					"content": []map[string]any{
						{"type": "text", "text": string(data)},
					},
				}
			}

		default:
			result = map[string]any{"error": fmt.Sprintf("unknown method: %s", req.Method)}
		}

		resp := map[string]any{
			"jsonrpc": "2.0",
			"id":      req.ID,
			"result":  result,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

func handleMCPSSE(cfg config, w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Send the MCP endpoint message
	fmt.Fprintf(w, "event: endpoint\ndata: /mcp\n\n")
	flusher.Flush()

	// Keep connection alive
	for {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(30 * time.Second):
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	cfg := loadConfig()

	mux := http.NewServeMux()
	mux.HandleFunc("/mcp", handleMCP(cfg))
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	log.Printf("[krateo-mcp-tools] listening on %s", cfg.listenAddr)
	log.Printf("[krateo-mcp-tools] tools: %s", strings.Join(toolNames(), ", "))
	if err := http.ListenAndServe(cfg.listenAddr, mux); err != nil {
		log.Fatalf("[krateo-mcp-tools] fatal: %v", err)
	}
}

func toolNames() []string {
	names := make([]string, len(tools))
	for i, t := range tools {
		names[i] = t.Name
	}
	return names
}
