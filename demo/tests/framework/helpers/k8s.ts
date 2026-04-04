/**
 * Kubernetes helper for E2E tests.
 *
 * Wraps kubectl commands for deploying test resources and cleanup.
 */

import { execSync } from "child_process";
import { testSelector } from "./test-id";

export interface ApplyOptions {
  namespace?: string;
  /** Additional labels to add (merged with test labels) */
  labels?: Record<string, string>;
}

/**
 * Apply a YAML manifest from a file path.
 */
export function applyManifest(path: string, opts: ApplyOptions = {}): void {
  const nsFlag = opts.namespace ? `-n ${opts.namespace}` : "";
  execSync(`kubectl apply -f ${path} ${nsFlag}`, { stdio: "pipe" });
}

/**
 * Apply inline YAML content.
 */
export function applyYaml(yaml: string, opts: ApplyOptions = {}): void {
  const nsFlag = opts.namespace ? `-n ${opts.namespace}` : "";
  execSync(`echo '${yaml.replace(/'/g, "'\\''")}' | kubectl apply ${nsFlag} -f -`, {
    stdio: "pipe",
  });
}

/**
 * Delete a resource by name.
 */
export function deleteResource(
  kind: string,
  name: string,
  namespace?: string
): void {
  const nsFlag = namespace ? `-n ${namespace}` : "";
  execSync(`kubectl delete ${kind} ${name} ${nsFlag} --ignore-not-found`, {
    stdio: "pipe",
  });
}

/**
 * Delete all resources matching a test run ID.
 * Used for test cleanup to ensure no test resources leak.
 */
export function cleanupTestResources(testId: string, namespace?: string): void {
  const nsFlag = namespace ? `-n ${namespace}` : "--all-namespaces";
  const selector = testSelector(testId);
  try {
    execSync(
      `kubectl delete all -l ${selector} ${nsFlag} --ignore-not-found`,
      { stdio: "pipe" }
    );
  } catch {
    // Best-effort cleanup — don't fail the test if cleanup fails
  }
}

/**
 * Wait for a pod to reach a specific phase (Running, Succeeded, Failed).
 */
export function waitForPodPhase(
  name: string,
  phase: string,
  namespace = "default",
  timeoutSeconds = 120
): boolean {
  try {
    execSync(
      `kubectl wait pod/${name} -n ${namespace} --for=jsonpath='{.status.phase}'=${phase} --timeout=${timeoutSeconds}s`,
      { stdio: "pipe" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get pod status as a simple string.
 */
export function getPodStatus(name: string, namespace = "default"): string {
  try {
    return execSync(
      `kubectl get pod ${name} -n ${namespace} -o jsonpath='{.status.phase}'`,
      { stdio: "pipe" }
    ).toString().trim().replace(/'/g, "");
  } catch {
    return "NotFound";
  }
}
