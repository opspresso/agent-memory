import { context, propagation, trace } from "@opentelemetry/api";
import { NodeSDK, type tracing } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createAuthenticationLogger,
  serializeErrorForLog
} from "@/infrastructure/observability/logger";
import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";
import {
  observeRetrieval,
  readTelemetryConfiguration
} from "@/infrastructure/observability/telemetry";

describe("retrieval trace privacy", () => {
  const spans: tracing.ReadableSpan[] = [];
  const sdk = new NodeSDK({
    resourceDetectors: [],
    spanProcessors: [{
      onStart() {},
      onEnd(span) { spans.push(span); },
      async shutdown() {},
      async forceFlush() {}
    }]
  });
  const access = {
    organizationId: "organization-1",
    userId: "user-1",
    role: "member" as const,
    teams: []
  };

  beforeAll(() => { sdk.start(); });
  beforeEach(() => { spans.length = 0; });
  afterAll(async () => {
    await sdk.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("records only the result count for successful retrieval", async () => {
    const values = [{ content: "private-memory-content" }];
    await expect(
      observeRetrieval("memory.search", access, 10, async () => values)
    ).resolves.toBe(values);
    expect(spans).toHaveLength(1);
    expect(JSON.stringify(spans[0]?.attributes)).toContain("resultCount");
    expect(JSON.stringify(spans[0]?.attributes)).not.toContain("private-memory-content");
  });

  it.each([
    new Error("SQL failed with private-search-query", {
      cause: new Error("private-document-content")
    }),
    "private-search-query"
  ])("keeps the original failure out of exported spans", async (failure) => {
    await expect(
      observeRetrieval("memory.search", access, 10, async () => { throw failure; })
    ).rejects.toBe(failure);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    const exported = JSON.stringify({
      status: span?.status,
      attributes: span?.attributes,
      events: span?.events
    });
    expect(exported).not.toContain("private-search-query");
    expect(exported).not.toContain("private-document-content");
    expect(exported).toContain("ERROR");
    expect(exported).toContain("retrieval failed");
  });
});

describe("structured error logging", () => {
  it("drops untrusted Better Auth logger arguments", () => {
    const records: unknown[] = [];
    const sink = {
      debug: (...args: unknown[]) => { records.push(args); },
      error: (...args: unknown[]) => { records.push(args); },
      info: (...args: unknown[]) => { records.push(args); },
      warn: (...args: unknown[]) => { records.push(args); }
    };
    const authenticationLogger = createAuthenticationLogger(sink);

    Reflect.apply(authenticationLogger.log, authenticationLogger, [
      "error",
      "Failed to parse state",
      { details: { state: "private-oauth-state" } }
    ]);

    expect(records).toEqual([
      [{ component: "better-auth" }, "Failed to parse state"]
    ]);
    expect(JSON.stringify(records)).not.toContain("private-oauth-state");
  });

  it("keeps type and code diagnostics without serializing untrusted messages", () => {
    const cause = new Error("Bearer secret-document-content");
    const error = Object.assign(
      new SyntaxError("Unexpected token 'private-customer-data'", { cause }),
      { code: "INVALID_DOCUMENT" }
    );

    const serialized = serializeErrorForLog(error);
    const output = JSON.stringify(serialized);

    expect(serialized).toMatchObject({
      type: "SyntaxError",
      code: "INVALID_DOCUMENT",
      cause: { type: "Error" }
    });
    expect(output).not.toContain("private-customer-data");
    expect(output).not.toContain("secret-document-content");
  });

  it("preserves allowlisted operational messages and bounded cause types", () => {
    const error = new SafeOperationalError(
      "embedding request failed with status 503",
      {
        cause: new Error("private provider response"),
        code: "EMBEDDING_HTTP_ERROR"
      }
    );

    expect(serializeErrorForLog(error)).toEqual({
      type: "SafeOperationalError",
      code: "EMBEDDING_HTTP_ERROR",
      message: "embedding request failed with status 503",
      cause: { type: "Error" }
    });
    expect(JSON.stringify(serializeErrorForLog(error))).not.toContain(
      "private provider response"
    );
  });

  it("rejects untrusted error metadata", () => {
    const error = Object.assign(new Error("private"), {
      name: "private customer data",
      code: "private-customer-data"
    });

    expect(serializeErrorForLog(error)).toMatchObject({ type: "Error" });
    expect(serializeErrorForLog(error)).not.toHaveProperty("code");
    expect(serializeErrorForLog("private-customer-data")).toEqual({
      type: "UnknownError"
    });
  });
});

describe("telemetry configuration", () => {
  it("disables Langfuse when credentials are absent", () => {
    expect(readTelemetryConfiguration({})).toBeNull();
  });

  it("requires a complete credential pair", () => {
    expect(() =>
      readTelemetryConfiguration({ LANGFUSE_PUBLIC_KEY: "pk-lf-test" })
    ).toThrow(
      "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set together"
    );
  });

  it("uses immediate export on Vercel and accepts an explicit mode", () => {
    expect(
      readTelemetryConfiguration({
        LANGFUSE_PUBLIC_KEY: "pk-lf-test",
        LANGFUSE_SECRET_KEY: "sk-lf-test",
        VERCEL: "1"
      })
    ).toMatchObject({ exportMode: "immediate" });
    expect(
      readTelemetryConfiguration({
        LANGFUSE_PUBLIC_KEY: "pk-lf-test",
        LANGFUSE_SECRET_KEY: "sk-lf-test",
        LANGFUSE_EXPORT_MODE: "batched"
      })
    ).toMatchObject({ exportMode: "batched" });
  });
});
