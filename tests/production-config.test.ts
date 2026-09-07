import { describe, expect, it } from "vitest";

import {
  assertProductionBootstrapConfiguration,
  assertProductionConfiguration
} from "@/lib/production-config";

const complete = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db:5432/agent_memory",
  BETTER_AUTH_SECRET: "a-production-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "https://memory.example.com",
  ADMIN_EMAILS: "admin@example.com",
  ALLOWED_EMAIL_DOMAINS: "example.com",
  S3_ENDPOINT: "https://s3.example.com",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_BUCKET: "agent-memory"
};

describe("production configuration", () => {
  it("requires database and encryption bootstrap settings before loading overrides", () => {
    expect(() =>
      assertProductionBootstrapConfiguration({ NODE_ENV: "production" })
    ).toThrow(
      "production bootstrap configuration is incomplete: DATABASE_URL, BETTER_AUTH_SECRET must be set"
    );
    expect(() =>
      assertProductionBootstrapConfiguration({ NODE_ENV: "development" })
    ).not.toThrow();
  });

  it("accepts a fully configured production environment", () => {
    expect(() => assertProductionConfiguration(complete)).not.toThrow();
  });

  it("allows unrestricted email domains in production", () => {
    expect(() =>
      assertProductionConfiguration({
        ...complete,
        ALLOWED_EMAIL_DOMAINS: undefined
      })
    ).not.toThrow();
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

  it("requires a strong auth secret and a secure public origin", () => {
    expect(() =>
      assertProductionConfiguration({ ...complete, BETTER_AUTH_SECRET: "short" })
    ).toThrow("BETTER_AUTH_SECRET must contain at least 32 characters");
    expect(() =>
      assertProductionConfiguration({ ...complete, BETTER_AUTH_URL: "not-a-url" })
    ).toThrow("BETTER_AUTH_URL must be a valid absolute URL");
    expect(() =>
      assertProductionConfiguration({
        ...complete,
        BETTER_AUTH_URL: "http://memory.example.com"
      })
    ).toThrow("BETTER_AUTH_URL must use HTTPS outside loopback environments");
  });

  it("prevents unverified self-signup on public production origins", () => {
    expect(() =>
      assertProductionConfiguration({ ...complete, AUTH_PASSWORD_SIGNUP: "true" })
    ).toThrow(
      "AUTH_PASSWORD_SIGNUP cannot be enabled on a public production origin without email verification"
    );
    expect(() =>
      assertProductionConfiguration({
        ...complete,
        AUTH_PASSWORD_SIGNUP: "true",
        BETTER_AUTH_URL: "http://127.0.0.1:3110"
      })
    ).not.toThrow();
  });

  it("does not constrain non-production environments", () => {
    expect(() =>
      assertProductionConfiguration({ NODE_ENV: "development" })
    ).not.toThrow();
    expect(() => assertProductionConfiguration({})).not.toThrow();
  });
});
