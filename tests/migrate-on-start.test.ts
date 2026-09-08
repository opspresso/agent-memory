import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertSingleOrganization: vi.fn(), migrate: vi.fn(), db: {} }));
vi.mock("@/infrastructure/database/repositories/installation-repository", () => ({ assertSingleOrganizationBeforeMigration: mocks.assertSingleOrganization }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: mocks.migrate }));
vi.mock("@/lib/database", () => ({ database: { db: mocks.db } }));

import { migrateOnStart } from "@/lib/migrate-on-start";

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
});
