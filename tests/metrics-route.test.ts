import { afterEach, describe, expect, it, vi } from "vitest";

import { version as appVersion } from "../package.json";

vi.mock("@/lib/runtime-settings", () => ({
  getEffectiveRuntimeEnvironment: vi.fn(async () => process.env)
}));

vi.mock("@/lib/process-metrics", () => ({
  processMetricsSnapshot: () => ({
    residentMemoryBytes: 100,
    heapTotalBytes: 80,
    heapUsedBytes: 40,
    externalMemoryBytes: 10,
    cpuSecondsTotal: 2.5,
    eventLoopDelayP95Seconds: 0.02,
    eventLoopDelayMaxSeconds: 0.05
  })
}));

import { GET } from "@/app/api/metrics/route";
import { getEffectiveRuntimeEnvironment } from "@/lib/runtime-settings";

describe("metrics route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not expose metrics when the token is absent or invalid", async () => {
    const disabled = await GET(new Request("https://memory.example.com/api/metrics"));
    expect(disabled.status).toBe(404);
    expect(disabled.headers.get("cache-control")).toBe("no-store");

    vi.stubEnv(
      "METRICS_BEARER_TOKEN",
      "agent-memory-metrics-token-000000000000"
    );
    const unauthorized = await GET(
      new Request("https://memory.example.com/api/metrics", {
        headers: { authorization: "Bearer wrong-token" }
      })
    );
    expect(unauthorized.status).toBe(404);
  });

  it("returns process metrics in Prometheus format", async () => {
    const token = "agent-memory-metrics-token-000000000000";
    vi.stubEnv("METRICS_BEARER_TOKEN", token);
    const response = await GET(
      new Request("https://memory.example.com/api/metrics", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain(
      `agent_memory_build_info{version="${appVersion}"} 1`
    );
    expect(body).toContain("process_resident_memory_bytes 100");
    expect(body).toContain("process_cpu_seconds_total 2.5");
    expect(body).not.toContain("organization_id");
    expect(body).not.toContain("user_id");
  });

  it("rejects an unsafe configured token", async () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "short-token");

    await expect(
      GET(new Request("https://memory.example.com/api/metrics"))
    ).rejects.toThrow("METRICS_BEARER_TOKEN must contain at least 32 characters");
  });

  it("uses a rotated DB token even when this replica still has the old env token", async () => {
    const oldToken = "old-metrics-token-0000000000000000";
    const newToken = "new-metrics-token-0000000000000000";
    vi.stubEnv("METRICS_BEARER_TOKEN", oldToken);
    vi.mocked(getEffectiveRuntimeEnvironment)
      .mockResolvedValueOnce({ METRICS_BEARER_TOKEN: newToken })
      .mockResolvedValueOnce({ METRICS_BEARER_TOKEN: newToken });
    const request = (token: string) => new Request("https://memory.example.com/api/metrics", {
      headers: { authorization: `Bearer ${token}` }
    });
    expect((await GET(request(oldToken))).status).toBe(404);
    expect((await GET(request(newToken))).status).toBe(200);
  });
});
