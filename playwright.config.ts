import "dotenv/config";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Use the pre-installed Chromium when present (CI containers / this dev environment).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const port = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      APP_BASE_URL: `http://localhost:${port}`,
      APP_SECRET: process.env.APP_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-e2e",
      UPLOAD_DIR: "./storage/e2e-uploads",
      // Bills are "emailed" into this folder; nothing leaves the machine.
      EMAIL_FROM: "OM ENTERPRISE <bills@example.test>",
      EMAIL_OUTBOX_DIR: "./storage/e2e-outbox",
      // Every test signs in from 127.0.0.1; keep the per-IP limit out of the way (account lockout still applies).
      LOGIN_RATE_LIMIT_PER_15MIN: "10000",
      // The server must not pick up real payment keys from a developer's .env: online payment stays on the UPI QR here.
      RAZORPAY_KEY_ID: "",
      RAZORPAY_KEY_SECRET: "",
      RAZORPAY_WEBHOOK_SECRET: "",
    },
  },
});
