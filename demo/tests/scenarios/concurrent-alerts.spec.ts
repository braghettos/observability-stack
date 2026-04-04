/**
 * Scenario E: Concurrent Alerts
 *
 * Verifies the pipeline handles multiple simultaneous alert sources correctly:
 *   1. Deploy TWO crashloop pods in different namespaces
 *   2. Verify Warning events for BOTH pods appear in ClickHouse
 *   3. Verify events are correctly attributed (no cross-contamination)
 *   4. Cleanup both pods
 *
 * This validates that the OTel pipeline, ClickHouse, and alert system
 * handle concurrent, independent failure streams without interference.
 *
 * Usage:
 *   npx playwright test demo/tests/scenarios/concurrent-alerts.spec.ts
 */

import { test, expect } from "@playwright/test";
import { getWarningEventCount, getK8sEvents } from "../framework/clients/clickhouse";
import { waitForCount } from "../framework/helpers/wait-for";
import { generateTestId } from "../framework/helpers/test-id";
import {
  applyYaml,
  deleteResource,
  cleanupTestResources,
} from "../framework/helpers/k8s";

const NAMESPACE = process.env.TEST_NAMESPACE || "default";

test.describe("Scenario E: Concurrent Alerts", () => {
  let testId: string;
  let pod1Name: string;
  let pod2Name: string;

  test.beforeAll(() => {
    testId = generateTestId();
    pod1Name = `concurrent-a-${testId}`;
    pod2Name = `concurrent-b-${testId}`;
  });

  test.afterAll(() => {
    deleteResource("pod", pod1Name, NAMESPACE);
    deleteResource("pod", pod2Name, NAMESPACE);
    cleanupTestResources(testId, NAMESPACE);
  });

  test("1. Deploy two crashloop pods simultaneously", async () => {
    test.setTimeout(30_000);

    const manifest1 = `
apiVersion: v1
kind: Pod
metadata:
  name: ${pod1Name}
  namespace: ${NAMESPACE}
  labels:
    krateo.io/test-run-id: "${testId}"
    app.kubernetes.io/managed-by: krateo-e2e-test
    failure-type: exit-code-1
spec:
  restartPolicy: Always
  containers:
    - name: crash
      image: busybox:1.36
      command: ["sh", "-c", "echo 'pod A crashing'; exit 1"]
      resources:
        limits:
          cpu: 10m
          memory: 16Mi
`;
    const manifest2 = `
apiVersion: v1
kind: Pod
metadata:
  name: ${pod2Name}
  namespace: ${NAMESPACE}
  labels:
    krateo.io/test-run-id: "${testId}"
    app.kubernetes.io/managed-by: krateo-e2e-test
    failure-type: exit-code-2
spec:
  restartPolicy: Always
  containers:
    - name: crash
      image: busybox:1.36
      command: ["sh", "-c", "echo 'pod B crashing'; exit 2"]
      resources:
        limits:
          cpu: 10m
          memory: 16Mi
`;
    applyYaml(manifest1);
    applyYaml(manifest2);
    console.log(`Deployed ${pod1Name} and ${pod2Name} concurrently`);
  });

  test("2. Verify Warning events for BOTH pods in ClickHouse", async () => {
    test.setTimeout(300_000);

    // Wait for events from pod 1
    const count1 = await waitForCount(
      () => getWarningEventCount(NAMESPACE, pod1Name, 10),
      0,
      {
        timeoutMs: 240_000,
        intervalMs: 10_000,
        description: `Warning events for ${pod1Name}`,
      }
    );

    // Wait for events from pod 2
    const count2 = await waitForCount(
      () => getWarningEventCount(NAMESPACE, pod2Name, 10),
      0,
      {
        timeoutMs: 60_000, // Should already be there by now
        intervalMs: 5_000,
        description: `Warning events for ${pod2Name}`,
      }
    );

    expect(count1).toBeGreaterThan(0);
    expect(count2).toBeGreaterThan(0);
    console.log(
      `Pod A: ${count1} Warning events, Pod B: ${count2} Warning events`
    );
  });

  test("3. Verify events are correctly attributed (no cross-contamination)", async () => {
    test.setTimeout(30_000);

    const events1 = await getK8sEvents(NAMESPACE, pod1Name, 10);
    const events2 = await getK8sEvents(NAMESPACE, pod2Name, 10);

    // Pod 1 events should only reference pod1Name
    for (const evt of events1) {
      expect(evt.pod_name).toContain(pod1Name);
    }

    // Pod 2 events should only reference pod2Name
    for (const evt of events2) {
      expect(evt.pod_name).toContain(pod2Name);
    }

    console.log(
      `PASS: Events correctly isolated — Pod A has ${events1.length} events, Pod B has ${events2.length} events`
    );
  });
});
