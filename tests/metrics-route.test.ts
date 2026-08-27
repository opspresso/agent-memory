import { describe, expect, it, vi } from "vitest";

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
  it("returns dependency-free process metrics in Prometheus format", async () => {
    const response = GET();
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
});
