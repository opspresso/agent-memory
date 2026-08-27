import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("metrics route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not expose metrics when the token is absent or invalid", async () => {
    const disabled = GET(new Request("https://memory.example.com/api/metrics"));
    expect(disabled.status).toBe(404);
    expect(disabled.headers.get("cache-control")).toBe("no-store");

    vi.stubEnv(
      "METRICS_BEARER_TOKEN",
      "agent-memory-metrics-token-000000000000"
    );
    const unauthorized = GET(
      new Request("https://memory.example.com/api/metrics", {
        headers: { authorization: "Bearer wrong-token" }
      })
    );
    expect(unauthorized.status).toBe(404);
  });

  it("returns dependency-free process metrics in Prometheus format", async () => {
    const token = "agent-memory-metrics-token-000000000000";
    vi.stubEnv("METRICS_BEARER_TOKEN", token);
    const response = GET(
      new Request("https://memory.example.com/api/metrics", {
        headers: { authorization: `Bearer ${token}` }
      })
    );
    const body = await response.text();

    expect(response.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain('agent_memory_build_info{version="0.2.1"} 1');
    expect(body).toContain("process_resident_memory_bytes 100");
    expect(body).toContain("process_cpu_seconds_total 2.5");
    expect(body).not.toContain("organization_id");
    expect(body).not.toContain("user_id");
  });

  it("rejects an unsafe configured token", () => {
    vi.stubEnv("METRICS_BEARER_TOKEN", "short-token");

    expect(() =>
      GET(new Request("https://memory.example.com/api/metrics"))
    ).toThrow("METRICS_BEARER_TOKEN must contain at least 32 characters");
  });
});
