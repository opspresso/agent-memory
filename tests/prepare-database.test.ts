import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), readiness: vi.fn(), pool: {} }));
vi.mock("@/infrastructure/database/schema-bootstrap.mjs", () => ({ initializeSchema: mocks.initialize }));
vi.mock("@/lib/database", () => ({ database: { pool: mocks.pool } }));
vi.mock("@/lib/health-service", () => ({ checkDatabaseReadiness: mocks.readiness }));

import { prepareDatabase } from "@/lib/prepare-database";

describe("database startup", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("checks readiness after initializing the current schema", async () => {
    await prepareDatabase();
    expect(mocks.initialize).toHaveBeenCalledWith(mocks.pool);
    expect(mocks.initialize.mock.invocationCallOrder[0]).toBeLessThan(mocks.readiness.mock.invocationCallOrder[0]!);
  });
  it("does not continue when existing schema is incompatible", async () => {
    mocks.initialize.mockRejectedValue(new Error("incompatible schema"));
    await expect(prepareDatabase()).rejects.toThrow("incompatible schema");
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("fails startup when the initialized schema is not ready", async () => {
    mocks.readiness.mockRejectedValue(new Error("schema not ready"));
    await expect(prepareDatabase()).rejects.toThrow("schema not ready");
  });
});
