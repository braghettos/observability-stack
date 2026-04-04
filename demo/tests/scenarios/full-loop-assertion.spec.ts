/**
 * Scenario A: Full-Loop Assertion Test
 *
 * End-to-end test that validates every stage of the closed-loop pipeline:
 *   1. Inject fault (deploy crashloop pod)
 *   2. Verify events appear in ClickHouse
 *   3. Verify Warning events accumulate (alert threshold)
 *   4. Cleanup and verify resolution (Warning events stop)
 *
 * This test does NOT require Slack/KAgent integration — it validates
 * the data pipeline and ClickHouse query layer that agents depend on.
 *
 * Usage:
 *   npx playwright test demo/tests/scenarios/full-loop-assertion.spec.ts
 *
 * Environment variables:
 *   CLICKHOUSE_URL — ClickHouse HTTP endpoint (default: http://localhost:8123)
 *   TEST_NAMESPACE — Namespace for test resources (default: default)
 */

import { test, expect } from "@playwright/test";
import { getK8sEvents, getWarningEventCount } from "../framework/clients/clickhouse";
import { waitForCount, waitForZero } from "../framework/helpers/wait-for";
import { generateTestId } from "../framework/helpers/test-id";
import {
  applyYaml,
  deleteResource,
  cleanupTestResources,
} from "../framework/helpers/k8s";

const NAMESPACE = process.env.TEST_NAMESPACE || "default";

test.describe("Scenario A: Full Closed-Loop Assertion", () => {
  let testId: string;
  let podName: string;

  test.beforeAll(() => {
    testId = generateTestId();
    podName = `crashloop-${testId}`;
  });

  test.afterAll(() => {
    // Guaranteed cleanup — delete test pod even if tests fail
    deleteResource("pod", podName, NAMESPACE);
    cleanupTestResources(testId, NAMESPACE);
  });

  test("1. Deploy crashloop pod to inject fault", async () => {
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
      command: ["sh", "-c", "echo 'test crash pod ${testId}'; exit 1"]
      resources:
        limits:
          cpu: 10m
          memory: 16Mi
`;
    applyYaml(manifest);
  });

  test("2. Verify K8s Warning events appear in ClickHouse", async () => {
    test.setTimeout(300_000); // 5 min — events must propagate through OTel pipeline

    // Wait for Warning events (BackOff, Failed) to appear in ClickHouse
    const count = await waitForCount(
      () => getWarningEventCount(NAMESPACE, podName, 10),
      0, // at least 1 Warning event
      {
        timeoutMs: 240_000,
        intervalMs: 10_000,
        description: `Warning events for ${podName} in ClickHouse`,
      }
    );

    expect(count).toBeGreaterThan(0);
    console.log(`Found ${count} Warning events for ${podName}`);
  });

  test("3. Verify event content is correct", async () => {
    test.setTimeout(30_000);

    const events = await getK8sEvents(NAMESPACE, podName, 10);
    expect(events.length).toBeGreaterThan(0);

    // At least one event should be a Warning with a recognizable reason
    const warningEvents = events.filter((e) => e.type === "Warning");
    expect(warningEvents.length).toBeGreaterThan(0);

    const reasons = warningEvents.map((e) => e.reason);
    const expectedReasons = ["BackOff", "Failed", "Killing"];
    const hasExpectedReason = reasons.some((r) =>
      expectedReasons.some((er) => r.includes(er))
    );
    expect(hasExpectedReason).toBe(true);

    console.log(
      `Warning event reasons: ${[...new Set(reasons)].join(", ")}`
    );
  });

  test("4. Verify alert threshold is met (count > 2)", async () => {
    test.setTimeout(180_000);

    // The alert threshold is 2 — wait until we have enough events
    const count = await waitForCount(
      () => getWarningEventCount(NAMESPACE, podName, 5),
      2,
      {
        timeoutMs: 120_000,
        intervalMs: 10_000,
        description: `Warning event count > 2 for ${podName}`,
      }
    );

    expect(count).toBeGreaterThan(2);
    console.log(
      `Alert threshold met: ${count} Warning events (threshold: 2)`
    );
  });

  test("5. Cleanup pod and verify events stop (resolution)", async () => {
    test.setTimeout(300_000);

    // Delete the crashloop pod — this simulates a successful remediation
    deleteResource("pod", podName, NAMESPACE);

    // Wait for Warning events to stop (no new events in last 2 minutes)
    await waitForZero(
      () => getWarningEventCount(NAMESPACE, podName, 2),
      {
        timeoutMs: 180_000,
        intervalMs: 15_000,
        description: `Zero Warning events for ${podName} in last 2 min`,
      }
    );

    console.log("Resolution verified: no Warning events in last 2 minutes");
  });
});
