import "dotenv/config";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Narrated walkthrough recordings (`npm run walkthrough`): every page and feature, recorded as
 * video with on-screen captions and ✅/❌ checks. Runs against the throwaway e2e database.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const port = Number(process.env.E2E_PORT ?? 3200);
const desktop = { width: 1280, height: 720 };
const phone = { width: 412, height: 915 };

export default defineConfig({
  testDir: "tests/walkthrough",
  // Separate runs (e.g. re-recording part of the set) keep their videos apart.
  outputDir: process.env.WALKTHROUGH_RAW ?? "walkthrough-output/raw",
  timeout: 420_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    actionTimeout: 15_000,
    launchOptions: { ...(executablePath ? { executablePath } : {}), slowMo: 90 },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile/,
      use: { viewport: desktop, video: { mode: "on", size: desktop } },
    },
    {
      name: "mobile",
      testMatch: /mobile/,
      dependencies: ["desktop"],
      use: { ...devices["Pixel 7"], viewport: phone, video: { mode: "on", size: phone } },
    },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      APP_BASE_URL: `http://localhost:${port}`,
      APP_SECRET: process.env.APP_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e",
      UPLOAD_DIR: "./storage/e2e-uploads",
      // Bills are "emailed" into this folder; nothing leaves the machine.
      EMAIL_FROM: "OM ENTERPRISE <bills@example.test>",
      EMAIL_OUTBOX_DIR: "./storage/e2e-outbox",
      LOGIN_RATE_LIMIT_PER_15MIN: "10000",
      // The server must not pick up real payment keys from a developer's .env: online payment stays on the UPI QR here.
      RAZORPAY_KEY_ID: "",
      RAZORPAY_KEY_SECRET: "",
      RAZORPAY_WEBHOOK_SECRET: "",
    },
  },
});
