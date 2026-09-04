import { describe, expect, it } from "vitest";

import { serializeErrorForLog } from "@/infrastructure/observability/logger";
import { readTelemetryConfiguration } from "@/infrastructure/observability/telemetry";

describe("structured error logging", () => {
  it("keeps diagnostics without serializing messages or causes", () => {
    const cause = new Error("Bearer secret-document-content");
    const error = Object.assign(
      new SyntaxError("Unexpected token 'private-customer-data'", { cause }),
      { code: "INVALID_DOCUMENT" }
    );

    const serialized = serializeErrorForLog(error);
    const output = JSON.stringify(serialized);

    expect(serialized).toMatchObject({
      type: "SyntaxError",
      code: "INVALID_DOCUMENT"
    });
    expect(output).not.toContain("private-customer-data");
    expect(output).not.toContain("secret-document-content");
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
