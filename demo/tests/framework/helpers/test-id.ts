/**
 * Test isolation via unique identifiers.
 *
 * Each test run generates a UUID that is used to label all test resources,
 * enabling ClickHouse queries and assertions to filter by test run.
 */

import { randomUUID } from "crypto";

/**
 * Generate a unique test run ID.
 * Format: test-<8 char hex>
 */
export function generateTestId(): string {
  return `test-${randomUUID().slice(0, 8)}`;
}

/**
 * Create a label map for test resources.
 */
export function testLabels(testId: string): Record<string, string> {
  return {
    "krateo.io/test-run-id": testId,
    "app.kubernetes.io/managed-by": "krateo-e2e-test",
  };
}

/**
 * Create a label selector string for kubectl commands.
 */
export function testSelector(testId: string): string {
  return `krateo.io/test-run-id=${testId}`;
}
