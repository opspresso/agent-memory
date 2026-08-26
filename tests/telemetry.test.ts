import { describe, expect, it } from "vitest";

import { readTelemetryConfiguration } from "@/infrastructure/observability/telemetry";

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
