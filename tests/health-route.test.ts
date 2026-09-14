import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, checkGraph, logError } = vi.hoisted(() => ({
  execute: vi.fn(),
  checkGraph: vi.fn(),
  logError: vi.fn()
}));

vi.mock("@/lib/health-service", async () => ({
  checkDatabaseReadiness: execute,
  checkKnowledgeGraphReadiness: checkGraph,
  DatabaseSchemaNotReadyError: (await import("@/infrastructure/database/schema-readiness")).DatabaseSchemaNotReadyError
}));

vi.mock("@/lib/observability", () => ({
  logger: { error: logError }
}));

import { GET } from "@/app/api/health/route";
import { DatabaseSchemaNotReadyError } from "@/infrastructure/database/schema-readiness";
import { KnowledgeGraphUnavailableError } from "@/domain/knowledge/knowledge-topology";

describe("health route", () => {
  beforeEach(() => {
    execute.mockReset();
    checkGraph.mockReset();
    logError.mockReset();
  });

  it("reports database readiness without allowing caches", async () => {
    execute.mockResolvedValue({});

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok", schema: "ok", neo4j: "ok" }
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
      checks: { database: "failed", schema: "unknown", neo4j: "unknown" }
    });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: failure,
        durationMs: expect.any(Number)
      }),
      "readiness check failed"
    );
  });

  it("reports schema fingerprint mismatch separately from database connectivity", async () => {
    execute.mockRejectedValue(new DatabaseSchemaNotReadyError());
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable", checks: { database: "ok", schema: "failed", neo4j: "unknown" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports Neo4j failure separately without exposing connection details", async () => {
    checkGraph.mockRejectedValue(new KnowledgeGraphUnavailableError({ cause: new Error("private connection details") }));
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable", checks: { database: "ok", schema: "ok", neo4j: "failed" } });
  });
});
