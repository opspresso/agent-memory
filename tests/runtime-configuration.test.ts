import { describe, expect, it } from "vitest";
import { validateRuntimeEnvironment } from "@/lib/runtime-configuration";

describe("shared runtime configuration validation", () => {
  const base = { AUTH_PASSWORD: "true" };
  it.each([
    { LOG_LEVEL: "" },
    { LANGFUSE_EXPORT_MODE: "" },
    { EMBEDDING_BASE_URL: "not-a-url", EMBEDDING_MODEL: "model" },
    { RERANKER_BASE_URL: "ftp://host", RERANKER_MODEL: "model" },
    { KNOWLEDGE_EXTRACTION_BASE_URL: "invalid", KNOWLEDGE_EXTRACTION_MODEL: "model" },
    { BETTER_AUTH_URL: "" },
    { OIDC_ISSUER: "invalid", OIDC_CLIENT_ID: "client", OIDC_CLIENT_SECRET: "secret" }
  ])("rejects settings that cannot initialize: %j", (patch) => {
    expect(() => validateRuntimeEnvironment({ ...base, ...patch })).toThrow();
  });
  it("requires a login method after clearing OAuth credentials", () => {
    expect(() => validateRuntimeEnvironment({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", AUTH_PASSWORD: "false" })).toThrow("At least one login method");
    expect(() => validateRuntimeEnvironment(base)).not.toThrow();
    expect(() => validateRuntimeEnvironment({ GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" })).not.toThrow();
  });
  it("allows unset logging options and HTTP endpoints for local providers", () => {
    expect(() => validateRuntimeEnvironment({ ...base, EMBEDDING_BASE_URL: "http://localhost:8000/v1", EMBEDDING_MODEL: "model" })).not.toThrow();
  });
});
