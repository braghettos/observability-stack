/**
 * Polling helpers for E2E tests.
 *
 * Waits for conditions to be met with configurable timeout and interval.
 * Used to wait for events to propagate through the OTel pipeline,
 * alerts to fire, and agents to respond.
 */

export interface WaitOptions {
  /** Maximum time to wait in milliseconds (default: 300_000 = 5 min) */
  timeoutMs?: number;
  /** Polling interval in milliseconds (default: 5_000 = 5s) */
  intervalMs?: number;
  /** Description for error messages */
  description?: string;
}

/**
 * Poll a condition function until it returns true or timeout is reached.
 * Throws if the condition is not met within the timeout.
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  opts: WaitOptions = {}
): Promise<void> {
  const {
    timeoutMs = 300_000,
    intervalMs = 5_000,
    description = "condition",
  } = opts;

  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;

  while (Date.now() < deadline) {
    try {
      const result = await condition();
      if (result) return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for ${description} after ${timeoutMs}ms` +
      (lastError ? `: ${lastError.message}` : "")
  );
}

/**
 * Poll a function until it returns a value (non-null/non-undefined).
 * Returns the resolved value.
 */
export async function waitForValue<T>(
  fn: () => Promise<T | null | undefined>,
  opts: WaitOptions = {}
): Promise<T> {
  let result: T | null | undefined;

  await waitFor(async () => {
    result = await fn();
    return result != null;
  }, opts);

  return result!;
}

/**
 * Wait for a numeric count to exceed a threshold.
 */
export async function waitForCount(
  fn: () => Promise<number>,
  threshold: number,
  opts: WaitOptions = {}
): Promise<number> {
  let count = 0;

  await waitFor(async () => {
    count = await fn();
    return count > threshold;
  }, {
    description: `count > ${threshold}`,
    ...opts,
  });

  return count;
}

/**
 * Wait for a count to reach zero (used for alert resolution verification).
 */
export async function waitForZero(
  fn: () => Promise<number>,
  opts: WaitOptions = {}
): Promise<void> {
  await waitFor(async () => {
    const count = await fn();
    return count === 0;
  }, {
    description: "count == 0",
    ...opts,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
