import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, logError } = vi.hoisted(() => ({
  execute: vi.fn(),
  logError: vi.fn()
}));

vi.mock("@/lib/container", () => ({
  database: { db: { execute } }
}));

vi.mock("@/lib/observability", () => ({
  logger: { error: logError }
}));

import { GET } from "@/app/api/health/route";

describe("health route", () => {
  beforeEach(() => {
    execute.mockReset();
    logError.mockReset();
  });

  it("reports database readiness without allowing caches", async () => {
    execute.mockResolvedValue({});

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok" }
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it("returns unavailable and logs a database failure", async () => {
    const failure = new Error("database unavailable");
    execute.mockRejectedValue(failure);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "unavailable",
      checks: { database: "failed" }
    });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        durationMs: expect.any(Number)
      }),
      "readiness check failed"
    );
  });
});
