import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  retries: 1,
  use: {
    baseURL: process.env.KRATEO_FRONTEND_URL || "http://localhost:8080",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "ui",
      testMatch: "scenario2-broken-blueprint.spec.ts",
      use: { browserName: "chromium" },
    },
    {
      name: "pipeline",
      testDir: "scenarios",
      timeout: 600_000, // 10 min — full-loop tests need more time
      use: { browserName: "chromium" },
    },
  ],
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
});
