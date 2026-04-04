/**
 * Scenario B: False Positive — Rolling Update
 *
 * Verifies that a normal rolling update does NOT trigger Warning events
 * that would fire the pod restart alert. This prevents alert fatigue
 * from routine deployments.
 *
 * The test:
 *   1. Deploys a healthy nginx Deployment (2 replicas)
 *   2. Triggers a rolling update (image tag change)
 *   3. Waits for rollout to complete
 *   4. Asserts NO Warning events were generated for the deployment's pods
 *
 * Usage:
 *   npx playwright test demo/tests/scenarios/false-positive.spec.ts
 *
 * Environment variables:
 *   CLICKHOUSE_URL — ClickHouse HTTP endpoint (default: http://localhost:8123)
 *   TEST_NAMESPACE — Namespace for test resources (default: default)
 */

import { test, expect } from "@playwright/test";
import { getWarningEventCount } from "../framework/clients/clickhouse";
import { generateTestId } from "../framework/helpers/test-id";
import { cleanupTestResources } from "../framework/helpers/k8s";
import { execSync } from "child_process";

const NAMESPACE = process.env.TEST_NAMESPACE || "default";

test.describe("Scenario B: False Positive — Rolling Update", () => {
  let testId: string;
  let deployName: string;

  test.beforeAll(() => {
    testId = generateTestId();
    deployName = `healthy-${testId}`;
  });

  test.afterAll(() => {
    // Guaranteed cleanup
    try {
      execSync(
        `kubectl delete deployment ${deployName} -n ${NAMESPACE} --ignore-not-found`,
        { stdio: "pipe" }
      );
    } catch { /* best effort */ }
    cleanupTestResources(testId, NAMESPACE);
  });

  test("1. Deploy healthy nginx Deployment", async () => {
    test.setTimeout(120_000);

    const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${deployName}
  namespace: ${NAMESPACE}
  labels:
    krateo.io/test-run-id: "${testId}"
    app.kubernetes.io/managed-by: krateo-e2e-test
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ${deployName}
  template:
    metadata:
      labels:
        app: ${deployName}
        krateo.io/test-run-id: "${testId}"
    spec:
      containers:
        - name: nginx
          image: nginx:1.25-alpine
          ports:
            - containerPort: 80
          resources:
            limits:
              cpu: 50m
              memory: 64Mi
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 2
            periodSeconds: 3
`;
    execSync(`echo '${manifest}' | kubectl apply -f -`, { stdio: "pipe" });

    // Wait for rollout to complete
    execSync(
      `kubectl rollout status deployment/${deployName} -n ${NAMESPACE} --timeout=90s`,
      { stdio: "pipe" }
    );
  });

  test("2. Trigger rolling update (image tag change)", async () => {
    test.setTimeout(120_000);

    // Update the image tag — this triggers a rolling update
    execSync(
      `kubectl set image deployment/${deployName} nginx=nginx:1.26-alpine -n ${NAMESPACE}`,
      { stdio: "pipe" }
    );

    // Wait for the rolling update to complete
    execSync(
      `kubectl rollout status deployment/${deployName} -n ${NAMESPACE} --timeout=90s`,
      { stdio: "pipe" }
    );

    console.log("Rolling update completed successfully");
  });

  test("3. Wait for event propagation window", async () => {
    test.setTimeout(120_000);

    // Wait 90 seconds for any events to propagate through OTel → ClickHouse
    // This is longer than the typical OTel batch interval (5s) + ClickHouse flush
    console.log("Waiting 90s for event propagation...");
    await new Promise((resolve) => setTimeout(resolve, 90_000));
  });

  test("4. Assert NO Warning events for the deployment", async () => {
    test.setTimeout(30_000);

    // Check for Warning events for pods in this deployment
    // A healthy rolling update should only produce Normal events (Scheduled, Pulling, Started)
    const warningCount = await getWarningEventCount(
      NAMESPACE,
      deployName,
      10 // last 10 minutes covers the entire test
    );

    console.log(`Warning events for ${deployName}: ${warningCount}`);

    // Zero Warning events expected during a normal rolling update
    expect(warningCount).toBe(0);
    console.log(
      "PASS: No Warning events during rolling update — no false positive"
    );
  });
});
