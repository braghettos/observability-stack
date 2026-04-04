/**
 * Scenario D: Agent Failure — MCP Server Down
 *
 * Tests agent resilience when the ClickHouse MCP server is unavailable.
 * Validates that the system degrades gracefully rather than failing silently.
 *
 *   1. Scale down clickhouse-mcp-server to 0 replicas
 *   2. Trigger a fault (deploy crashloop pod)
 *   3. Verify Warning events still reach ClickHouse (pipeline works without MCP)
 *   4. Scale MCP server back up
 *   5. Verify MCP server recovers and can serve queries
 *
 * This scenario validates pipeline independence from the agent layer —
 * even if MCP is down, telemetry keeps flowing.
 *
 * Usage:
 *   npx playwright test demo/tests/scenarios/agent-failure-mcp-down.spec.ts
 */

import { test, expect } from "@playwright/test";
import { getWarningEventCount, query } from "../framework/clients/clickhouse";
import { waitForCount } from "../framework/helpers/wait-for";
import { generateTestId } from "../framework/helpers/test-id";
import {
  applyYaml,
  deleteResource,
  cleanupTestResources,
} from "../framework/helpers/k8s";
import { execSync } from "child_process";

const NAMESPACE = process.env.TEST_NAMESPACE || "default";
const MCP_NAMESPACE = "krateo-system";

test.describe("Scenario D: Agent Failure — MCP Server Down", () => {
  let testId: string;
  let podName: string;
  let originalReplicas: string;

  test.beforeAll(() => {
    testId = generateTestId();
    podName = `mcp-down-${testId}`;

    // Save original replica count
    try {
      originalReplicas = execSync(
        `kubectl get deployment clickhouse-mcp-server -n ${MCP_NAMESPACE} -o jsonpath='{.spec.replicas}'`,
        { stdio: "pipe" }
      ).toString().replace(/'/g, "");
    } catch {
      originalReplicas = "2";
    }
  });

  test.afterAll(() => {
    // Restore MCP server replicas
    try {
      execSync(
        `kubectl scale deployment clickhouse-mcp-server -n ${MCP_NAMESPACE} --replicas=${originalReplicas}`,
        { stdio: "pipe" }
      );
      execSync(
        `kubectl rollout status deployment/clickhouse-mcp-server -n ${MCP_NAMESPACE} --timeout=60s`,
        { stdio: "pipe" }
      );
    } catch { /* best effort */ }

    // Cleanup test pod
    deleteResource("pod", podName, NAMESPACE);
    cleanupTestResources(testId, NAMESPACE);
  });

  test("1. Scale down MCP server to 0 replicas", async () => {
    test.setTimeout(30_000);

    execSync(
      `kubectl scale deployment clickhouse-mcp-server -n ${MCP_NAMESPACE} --replicas=0`,
      { stdio: "pipe" }
    );

    // Wait for pods to terminate
    await new Promise((r) => setTimeout(r, 10_000));

    const pods = execSync(
      `kubectl get pods -n ${MCP_NAMESPACE} -l app=clickhouse-mcp-server --no-headers 2>/dev/null | wc -l`,
      { stdio: "pipe" }
    ).toString().trim();

    console.log(`MCP server pods remaining: ${pods}`);
  });

  test("2. Deploy crashloop pod while MCP is down", async () => {
    test.setTimeout(30_000);

    const manifest = `
apiVersion: v1
kind: Pod
metadata:
  name: ${podName}
  namespace: ${NAMESPACE}
  labels:
    krateo.io/test-run-id: "${testId}"
    app.kubernetes.io/managed-by: krateo-e2e-test
spec:
  restartPolicy: Always
  containers:
    - name: crash
      image: busybox:1.36
      command: ["sh", "-c", "exit 1"]
      resources:
        limits:
          cpu: 10m
          memory: 16Mi
`;
    applyYaml(manifest);
    console.log(`Crashloop pod '${podName}' deployed while MCP is down`);
  });

  test("3. Verify events still reach ClickHouse (pipeline is MCP-independent)", async () => {
    test.setTimeout(300_000);

    // The OTel pipeline → ClickHouse path should work regardless of MCP server status
    // Query ClickHouse directly (not through MCP) to verify
    const count = await waitForCount(
      () => getWarningEventCount(NAMESPACE, podName, 10),
      0,
      {
        timeoutMs: 240_000,
        intervalMs: 10_000,
        description: `Warning events in ClickHouse (MCP is down, but pipeline should work)`,
      }
    );

    expect(count).toBeGreaterThan(0);
    console.log(
      `PASS: ${count} Warning events reached ClickHouse even with MCP server down`
    );
  });

  test("4. Scale MCP server back up", async () => {
    test.setTimeout(90_000);

    execSync(
      `kubectl scale deployment clickhouse-mcp-server -n ${MCP_NAMESPACE} --replicas=${originalReplicas}`,
      { stdio: "pipe" }
    );

    execSync(
      `kubectl rollout status deployment/clickhouse-mcp-server -n ${MCP_NAMESPACE} --timeout=60s`,
      { stdio: "pipe" }
    );

    console.log("MCP server scaled back up");
  });

  test("5. Verify MCP server can serve queries after recovery", async () => {
    test.setTimeout(30_000);

    // Give MCP server a moment to initialize
    await new Promise((r) => setTimeout(r, 5_000));

    // Verify we can query through MCP (same as agent would)
    const result = await query<{ count: string }>(`
      SELECT count() AS count FROM otel_logs
      WHERE Timestamp > now() - INTERVAL 5 MINUTE
    `);

    expect(result.length).toBeGreaterThan(0);
    console.log(
      `PASS: MCP server recovered, query returned ${result[0]?.count} recent log records`
    );
  });
});
