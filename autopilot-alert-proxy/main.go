// Package main implements the Krateo Autopilot Alert Proxy.
//
// Sits between HyperDX webhooks and the KAgent/Slack integration to:
//   1. Deduplicate alerts within a configurable time window
//   2. Correlate related alerts (same namespace, same node)
//   3. Forward enriched, deduplicated alerts to Slack/KAgent
//   4. Provide a direct webhook path (bypass Slack if needed)
//
// This eliminates alert storms from cascading failures and reduces
// noise for the agent orchestration layer.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type config struct {
	listenAddr     string
	slackWebhook   string
	dedupeWindowS  int
	cooldownS      int
	stormThreshold int
	botMention     string
}

func loadConfig() config {
	return config{
		listenAddr:     getEnv("LISTEN_ADDR", ":8090"),
		slackWebhook:   getEnv("SLACK_WEBHOOK_URL", ""),
		dedupeWindowS:  getEnvInt("DEDUPE_WINDOW_SECONDS", 300),
		cooldownS:      getEnvInt("COOLDOWN_SECONDS", 60),
		stormThreshold: getEnvInt("STORM_THRESHOLD", 10),
		botMention:     getEnv("KRATEO_BOT_MENTION", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	var n int
	fmt.Sscanf(v, "%d", &n)
	if n <= 0 {
		return fallback
	}
	return n
}

// ---------------------------------------------------------------------------
// Alert deduplication
// ---------------------------------------------------------------------------

type alertKey struct {
	namespace string
	resource  string
	reason    string
}

type alertState struct {
	firstSeen time.Time
	lastSeen  time.Time
	count     int
	forwarded bool
}

type deduplicator struct {
	mu     sync.Mutex
	alerts map[alertKey]*alertState
	window time.Duration
}

func newDeduplicator(windowSeconds int) *deduplicator {
	d := &deduplicator{
		alerts: make(map[alertKey]*alertState),
		window: time.Duration(windowSeconds) * time.Second,
	}
	go d.cleanup()
	return d
}

// shouldForward returns true if this alert should be forwarded to Slack.
// Deduplicates by (namespace, resource, reason) within the time window.
func (d *deduplicator) shouldForward(key alertKey) (forward bool, count int) {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now()
	state, exists := d.alerts[key]

	if !exists || now.Sub(state.firstSeen) > d.window {
		// New alert or window expired — forward it
		d.alerts[key] = &alertState{
			firstSeen: now,
			lastSeen:  now,
			count:     1,
			forwarded: true,
		}
		return true, 1
	}

	// Duplicate within window — suppress
	state.lastSeen = now
	state.count++
	return false, state.count
}

// stormCount returns the total number of alerts in the current window.
func (d *deduplicator) stormCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()

	total := 0
	now := time.Now()
	for _, state := range d.alerts {
		if now.Sub(state.firstSeen) <= d.window {
			total += state.count
		}
	}
	return total
}

func (d *deduplicator) cleanup() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		d.mu.Lock()
		now := time.Now()
		for key, state := range d.alerts {
			if now.Sub(state.lastSeen) > d.window*2 {
				delete(d.alerts, key)
			}
		}
		d.mu.Unlock()
	}
}

// ---------------------------------------------------------------------------
// HyperDX webhook payload
// ---------------------------------------------------------------------------

type hyperdxAlert struct {
	AlertName string `json:"alertName"`
	Message   string `json:"message"`
	Query     string `json:"query"`
	TimeRange struct {
		Start string `json:"start"`
		End   string `json:"end"`
	} `json:"timeRange"`
	Value     float64 `json:"value"`
	Threshold float64 `json:"threshold"`
	GroupBy   map[string]string `json:"groupBy"`
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

func handleWebhook(cfg config, dedup *deduplicator) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read error", http.StatusBadRequest)
			return
		}

		var alert hyperdxAlert
		if err := json.Unmarshal(body, &alert); err != nil {
			log.Printf("[proxy] invalid alert JSON: %v", err)
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}

		// Extract dedup key from alert
		ns := alert.GroupBy["k8s.namespace.name"]
		resource := alert.GroupBy["k8s.pod.name"]
		key := alertKey{
			namespace: ns,
			resource:  resource,
			reason:    alert.AlertName,
		}

		// Check for alert storm
		stormCount := dedup.stormCount()
		if stormCount >= cfg.stormThreshold {
			log.Printf("[proxy] ALERT STORM: %d alerts in window (threshold: %d). Suppressing individual alerts.",
				stormCount, cfg.stormThreshold)

			// Send a single storm summary instead of individual alerts
			stormMsg := fmt.Sprintf(
				"ALERT STORM: %d alerts detected in %ds window. Suppressing individual alerts. %s please investigate cluster-wide issue.",
				stormCount, cfg.dedupeWindowS, cfg.botMention)

			forwardToSlack(cfg, stormMsg)
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"status": "storm_suppressed"}`)
			return
		}

		// Deduplicate
		forward, count := dedup.shouldForward(key)
		if !forward {
			log.Printf("[proxy] suppressed duplicate alert #%d: %s/%s (%s)",
				count, ns, resource, alert.AlertName)
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `{"status": "deduplicated", "count": %d}`, count)
			return
		}

		// Enrich and forward
		msg := fmt.Sprintf(
			"%s | namespace: %s, resource: %s, value: %.0f (threshold: %.0f). %s",
			alert.AlertName, ns, resource, alert.Value, alert.Threshold, cfg.botMention)

		log.Printf("[proxy] forwarding alert: %s/%s (%s)", ns, resource, alert.AlertName)
		forwardToSlack(cfg, msg)

		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"status": "forwarded"}`)
	}
}

func forwardToSlack(cfg config, message string) {
	if cfg.slackWebhook == "" {
		log.Printf("[proxy] no SLACK_WEBHOOK_URL configured, skipping forward")
		return
	}

	payload, _ := json.Marshal(map[string]string{"text": message})
	resp, err := http.Post(cfg.slackWebhook, "application/json", bytes.NewReader(payload))
	if err != nil {
		log.Printf("[proxy] slack forward error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[proxy] slack returned %d: %s", resp.StatusCode, string(body))
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	cfg := loadConfig()
	dedup := newDeduplicator(cfg.dedupeWindowS)

	mux := http.NewServeMux()
	mux.HandleFunc("/webhook", handleWebhook(cfg, dedup))
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	log.Printf("[alert-proxy] listening on %s", cfg.listenAddr)
	log.Printf("[alert-proxy] dedupe window: %ds, storm threshold: %d",
		cfg.dedupeWindowS, cfg.stormThreshold)
	if err := http.ListenAndServe(cfg.listenAddr, mux); err != nil {
		log.Fatalf("[alert-proxy] fatal: %v", err)
	}
}
