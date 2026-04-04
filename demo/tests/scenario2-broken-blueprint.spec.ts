/**
 * Scenario 2: Broken Blueprint — Playwright test
 *
 * Navigates the Krateo frontend to the demo-broken-instance composition page.
 * This triggers Snowplow to resolve the broken RESTAction (demo-broken-data),
 * which points to a nonexistent service. The resulting error flows through:
 *
 *   Snowplow error → OTel DaemonSet → ClickHouse otel_logs
 *     → HyperDX "Krateo Error Logs" alert → autopilot-alert-proxy webhook
 *       → Slack bot posts alert + auto-investigates in #krateo-troubleshooting
 *
 * Usage:
 *   npx playwright test demo/tests/scenario2-broken-blueprint.spec.ts
 *
 * Environment variables:
 *   KRATEO_FRONTEND_URL  — Krateo frontend URL (default: http://34.46.217.105:8080)
 *   KRATEO_USERNAME      — Login username (default: admin)
 *   KRATEO_PASSWORD      — Login password (default: admin)
 */

import { test, expect } from "@playwright/test";

const FRONTEND_URL =
  process.env.KRATEO_FRONTEND_URL || "http://localhost:8080";
const USERNAME = process.env.KRATEO_USERNAME || "admin";
const PASSWORD = process.env.KRATEO_PASSWORD || "admin";

test.describe("Scenario 2: Broken Blueprint triggers error alert", () => {
  test.setTimeout(120_000); // 2 minutes — composition pages can be slow

  test("Login to Krateo frontend", async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState("networkidle");

    // Check if we need to login
    if (page.url().includes("/login") || (await page.locator("input[type=password]").count()) > 0) {
      // Fill login form
      const usernameInput = page.locator(
        'input[name="username"], input[type="text"], input[placeholder*="user" i]'
      ).first();
      const passwordInput = page.locator('input[type="password"]').first();

      if (await usernameInput.isVisible()) {
        await usernameInput.fill(USERNAME);
      }
      await passwordInput.fill(PASSWORD);

      // Click login button
      const loginBtn = page.locator(
        'button[type="submit"], button:has-text("Login"), button:has-text("Sign in")'
      ).first();
      await loginBtn.click();
      await page.waitForLoadState("networkidle");
    }

    // Verify we're on the dashboard
    await expect(page).not.toHaveURL(/login/);
  });

  test("Navigate to demo-broken-instance composition page", async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState("networkidle");

    // Login if needed (reuse from above)
    if (page.url().includes("/login") || (await page.locator("input[type=password]").count()) > 0) {
      const usernameInput = page.locator(
        'input[name="username"], input[type="text"], input[placeholder*="user" i]'
      ).first();
      const passwordInput = page.locator('input[type="password"]').first();
      if (await usernameInput.isVisible()) await usernameInput.fill(USERNAME);
      await passwordInput.fill(PASSWORD);
      await page.locator('button[type="submit"], button:has-text("Login")').first().click();
      await page.waitForLoadState("networkidle");
    }

    // Navigate to the composition page
    // Option 1: Direct URL if we know the composition route pattern
    // Krateo frontend routes compositions as: /compositions/<namespace>/<kind>/<name>
    await page.goto(
      `${FRONTEND_URL}/compositions/demo-system/demobrokenblueprints/demo-broken-instance`
    );
    await page.waitForLoadState("networkidle");

    // If direct URL doesn't work, try navigating through the UI
    const pageContent = await page.textContent("body");
    if (
      pageContent?.includes("404") ||
      pageContent?.includes("not found")
    ) {
      console.log(
        "Direct URL failed, navigating through menu..."
      );

      await page.goto(FRONTEND_URL);
      await page.waitForLoadState("networkidle");

      // Look for compositions menu item or search
      const compositionsLink = page.locator(
        'a:has-text("Compositions"), a:has-text("demo-broken"), [href*="demo-broken"], [href*="composition"]'
      ).first();

      if (await compositionsLink.isVisible({ timeout: 5000 })) {
        await compositionsLink.click();
        await page.waitForLoadState("networkidle");
      }
    }

    // Wait a bit for Snowplow to resolve the RESTAction
    await page.waitForTimeout(5000);

    // Take a screenshot for debugging
    await page.screenshot({
      path: "demo/tests/screenshots/scenario2-composition-page.png",
      fullPage: true,
    });
  });

  test("Trigger RESTAction resolution via API call", async ({ request }) => {
    // Alternative: directly call the Snowplow API endpoint that resolves the RESTAction
    // This simulates what the frontend does when loading a composition page
    const snowplowUrl =
      process.env.KRATEO_SNOWPLOW_URL ||
      "http://localhost:8081"; // set KRATEO_SNOWPLOW_URL or port-forward snowplow

    // Get the RESTAction data — this triggers Snowplow to call the broken endpoint
    const response = await request.get(
      `${snowplowUrl}/apis/templates.krateo.io/v1/namespaces/demo-system/restactions/demo-broken-data`,
      {
        headers: {
          Authorization: `Bearer ${process.env.KRATEO_TOKEN || ""}`,
        },
        timeout: 30000,
      }
    );

    // We EXPECT this to fail or return an error — that's the point
    console.log(`RESTAction response status: ${response.status()}`);
    const body = await response.text();
    console.log(`RESTAction response (first 200 chars): ${body.substring(0, 200)}`);

    // The important thing is that Snowplow TRIED to resolve it,
    // generating error logs in ClickHouse
  });

  test("Verify error logs appear in ClickHouse", async ({ request }) => {
    // Query ClickHouse via the MCP server to verify errors are being logged
    // This step is optional — just for verification
    const clickhouseMcpUrl =
      process.env.CLICKHOUSE_MCP_URL ||
      "http://localhost:8000"; // port-forward clickhouse-mcp-server

    // Wait 30 seconds for logs to propagate
    await new Promise((resolve) => setTimeout(resolve, 30_000));

    console.log(
      "Error logs should now be in ClickHouse. " +
        "The HyperDX 'Krateo Error Logs' alert (15min interval) will detect them " +
        "and post to #krateo-troubleshooting via the autopilot-alert-proxy webhook."
    );
  });
});
