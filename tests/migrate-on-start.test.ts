import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertSingleOrganization: vi.fn(), migrate: vi.fn(), readiness: vi.fn(), db: {} }));
vi.mock("@/infrastructure/database/repositories/installation-repository", () => ({ assertSingleOrganizationBeforeMigration: mocks.assertSingleOrganization }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: mocks.migrate }));
vi.mock("@/lib/database", () => ({ database: { db: mocks.db } }));
vi.mock("@/lib/health-service", () => ({ checkDatabaseReadiness: mocks.readiness }));

import { migrateOnStart, prepareDatabase } from "@/lib/migrate-on-start";

describe("startup migration", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("rejects an unsupported installation before any schema migration", async () => {
    mocks.assertSingleOrganization.mockRejectedValue(new Error("multiple organizations"));
    await expect(migrateOnStart()).rejects.toThrow("multiple organizations");
    expect(mocks.migrate).not.toHaveBeenCalled();
  });

  it("checks the installation before applying migrations", async () => {
    await migrateOnStart();
    expect(mocks.assertSingleOrganization).toHaveBeenCalledWith(mocks.db);
    expect(mocks.migrate).toHaveBeenCalledWith(mocks.db, expect.objectContaining({ migrationsFolder: expect.stringMatching(/drizzle$/) }));
    expect(mocks.assertSingleOrganization.mock.invocationCallOrder[0]).toBeLessThan(mocks.migrate.mock.invocationCallOrder[0]!);
  });

  it("checks readiness after optional migration", async () => {
    await prepareDatabase(true);
    expect(mocks.migrate.mock.invocationCallOrder[0]).toBeLessThan(mocks.readiness.mock.invocationCallOrder[0]!);
  });

  it("fails startup for pending migrations even when automatic migration is disabled", async () => {
    mocks.readiness.mockRejectedValue(new Error("migrations pending"));
    await expect(prepareDatabase(false)).rejects.toThrow("migrations pending");
    expect(mocks.migrate).not.toHaveBeenCalled();
  });

  it("does not proceed to readiness if migration fails", async () => {
    mocks.migrate.mockRejectedValue(new Error("migration failed"));
    await expect(prepareDatabase(true)).rejects.toThrow("migration failed");
    expect(mocks.readiness).not.toHaveBeenCalled();
  });
});
