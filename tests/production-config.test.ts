import { describe, expect, it } from "vitest";

import { assertProductionConfiguration } from "@/lib/production-config";

const complete = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db:5432/agent_memory",
  ADMIN_EMAILS: "admin@example.com",
  ALLOWED_EMAIL_DOMAINS: "example.com",
  S3_ENDPOINT: "https://s3.example.com",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_BUCKET: "agent-memory"
};

describe("production configuration", () => {
  it("accepts a fully configured production environment", () => {
    expect(() => assertProductionConfiguration(complete)).not.toThrow();
  });

  it("fails fast when required production settings are missing", () => {
    expect(() =>
      assertProductionConfiguration({
        ...complete,
        DATABASE_URL: undefined,
        ADMIN_EMAILS: "  "
      })
    ).toThrow(
      "production configuration is incomplete: DATABASE_URL, ADMIN_EMAILS must be set"
    );
  });

  it("does not constrain non-production environments", () => {
    expect(() =>
      assertProductionConfiguration({ NODE_ENV: "development" })
    ).not.toThrow();
    expect(() => assertProductionConfiguration({})).not.toThrow();
  });
});
