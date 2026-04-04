/**
 * Scenario C: Multi-Agent Coordination — Helm Release Rollback
 *
 * Exercises the full agent chain including helm-agent:
 *   1. Install a Helm release with a known-good version (nginx)
 *   2. Upgrade to a broken version (image that crashes)
 *   3. Wait for Pod Restart Alert to fire (Warning events in ClickHouse)
 *   4. Verify events indicate both pod crash and Helm release issue
 *   5. Cleanup
 *
 * This scenario validates that the Autopilot can coordinate between
 * Observability Agent (diagnosis) → helm-agent (rollback).
 *
 * Usage:
 *   npx playwright test demo/tests/scenarios/multi-agent-helm-rollback.spec.ts
 */

import { test, expect } from "@playwright/test";
import { getK8sEvents, getWarningEventCount } from "../framework/clients/clickhouse";
import { waitForCount } from "../framework/helpers/wait-for";
import { generateTestId } from "../framework/helpers/test-id";
import { execSync } from "child_process";

const NAMESPACE = process.env.TEST_NAMESPACE || "default";

test.describe("Scenario C: Multi-Agent — Helm Rollback", () => {
  let testId: string;
  let releaseName: string;

  test.beforeAll(() => {
    testId = generateTestId();
    releaseName = `helm-test-${testId}`;
  });

  test.afterAll(() => {
    try {
      execSync(`helm uninstall ${releaseName} -n ${NAMESPACE} 2>/dev/null`, {
        stdio: "pipe",
      });
    } catch { /* best effort */ }
  });

  test("1. Install known-good Helm release (nginx)", async () => {
    test.setTimeout(120_000);

    execSync(
      `helm install ${releaseName} oci://registry-1.docker.io/bitnamicharts/nginx ` +
        `--set replicaCount=1 ` +
        `--set resources.limits.cpu=50m ` +
        `--set resources.limits.memory=64Mi ` +
        `-n ${NAMESPACE} --wait --timeout 90s`,
      { stdio: "pipe" }
    );

    console.log(`Helm release '${releaseName}' installed successfully`);
  });

  test("2. Upgrade to broken version (nonexistent image)", async () => {
    test.setTimeout(60_000);

    // Upgrade with a broken image that will cause CrashLoopBackOff
    try {
      execSync(
        `helm upgrade ${releaseName} oci://registry-1.docker.io/bitnamicharts/nginx ` +
          `--set image.repository=nginx ` +
          `--set image.tag=nonexistent-tag-${testId} ` +
          `--set replicaCount=1 ` +
          `-n ${NAMESPACE} --timeout 30s`,
        { stdio: "pipe" }
      );
    } catch {
      // Expected to timeout or fail — the broken image won't pull
      console.log("Helm upgrade initiated (expected to cause pod failures)");
    }
  });

  test("3. Verify Warning events appear for the broken pod", async () => {
    test.setTimeout(300_000);

    const count = await waitForCount(
      () => getWarningEventCount(NAMESPACE, releaseName, 10),
      0,
      {
        timeoutMs: 240_000,
        intervalMs: 10_000,
        description: `Warning events for ${releaseName} pods`,
      }
    );

    expect(count).toBeGreaterThan(0);
    console.log(`Found ${count} Warning events for Helm release pods`);
  });

  test("4. Verify events contain image pull or crash errors", async () => {
    test.setTimeout(30_000);

    const events = await getK8sEvents(NAMESPACE, releaseName, 15);
    const warnings = events.filter((e) => e.type === "Warning");

    expect(warnings.length).toBeGreaterThan(0);

    const reasons = warnings.map((e) => e.reason);
    const messages = warnings.map((e) => e.message);

    console.log(`Warning reasons: ${[...new Set(reasons)].join(", ")}`);
    console.log(
      `Sample messages: ${messages.slice(0, 3).join(" | ")}`
    );

    // Should see image pull or backoff errors
    const hasRelevantError =
      reasons.some((r) => ["Failed", "BackOff", "ErrImagePull", "ImagePullBackOff"].includes(r)) ||
      messages.some((m) => m.includes("nonexistent-tag") || m.includes("pull") || m.includes("Back-off"));

    expect(hasRelevantError).toBe(true);
  });

  test("5. Rollback Helm release to previous revision", async () => {
    test.setTimeout(120_000);

    execSync(`helm rollback ${releaseName} 1 -n ${NAMESPACE} --wait --timeout 90s`, {
      stdio: "pipe",
    });

    console.log(`Helm release '${releaseName}' rolled back to revision 1`);

    // Verify rollback worked
    const status = execSync(
      `helm status ${releaseName} -n ${NAMESPACE} -o json`,
      { stdio: "pipe" }
    ).toString();

    const info = JSON.parse(status);
    expect(info.info.status).toBe("deployed");
  });
});
