import { randomUUID } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const e2eRunId = process.env.E2E_RUN_ID ?? randomUUID();
process.env.E2E_RUN_ID = e2eRunId;
const e2eAdminEmails = Array.from({ length: 3 }, (_, retry) => [
  `e2e+${e2eRunId}-${retry}@nalbam.com`,
  `e2e-admin2+${e2eRunId}-${retry}@nalbam.com`,
  `e2e-ux+${e2eRunId}-${retry}@nalbam.com`
])
  .flat()
  .join(",");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.E2E_AUTHENTICATED === "true" ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // The dev web server compiles each route on first visit; on slower CI
  // runners that regularly exceeds Playwright's 5s default.
  expect: { timeout: 15_000 },
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
    // A production server keeps route responses fast and avoids the dev
    // compiler's memory pressure on shared CI runners.
    command:
      "./node_modules/.bin/next build && mkdir -p .next-e2e/standalone/database .next-e2e/standalone/.next-e2e/static .next-e2e/standalone/public && cp -R .next-e2e/static/. .next-e2e/standalone/.next-e2e/static/ && cp -R public/. .next-e2e/standalone/public/ && cp database/schema.sql .next-e2e/standalone/database/schema.sql && HOSTNAME=127.0.0.1 PORT=3110 node .next-e2e/standalone/server.js",
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://agent_memory:agent_memory@127.0.0.1:5433/agent_memory",
      AUTH_PASSWORD: "true",
      AUTH_PASSWORD_SIGNUP: "true",
      ADMIN_EMAILS: e2eAdminEmails,
      ALLOWED_EMAIL_DOMAINS: "nalbam.com",
      BETTER_AUTH_SECRET: "agent-memory-playwright-secret-000000000000",
      BETTER_AUTH_URL: "http://127.0.0.1:3110",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://127.0.0.1:9010",
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "agent_memory",
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "agent_memory_dev",
      S3_BUCKET: process.env.S3_BUCKET ?? "agent-memory",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      OIDC_CLIENT_ID: "",
      OIDC_CLIENT_SECRET: "",
      OIDC_ISSUER: ""
    },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    url: "http://127.0.0.1:3110"
  }
});
