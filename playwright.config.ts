import { randomUUID } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const e2eRunId = process.env.E2E_RUN_ID ?? randomUUID();
process.env.E2E_RUN_ID = e2eRunId;
const e2eAdminEmails = Array.from(
  { length: 3 },
  (_, retry) => `e2e+${e2eRunId}-${retry}@nalbam.com`
).join(",");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3110",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3110",
    env: {
      WATCHPACK_POLLING: "true",
      NEXT_DIST_DIR: ".next-e2e",
      AUTH_PASSWORD: "true",
      AUTH_PASSWORD_SIGNUP: "true",
      ADMIN_EMAILS: e2eAdminEmails,
      ALLOWED_EMAIL_DOMAINS: "nalbam.com",
      BETTER_AUTH_SECRET: "agent-memory-playwright-secret-000000000000",
      BETTER_AUTH_URL: "http://127.0.0.1:3110",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      OIDC_CLIENT_ID: "",
      OIDC_CLIENT_SECRET: "",
      OIDC_ISSUER: ""
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3110"
  }
});
