import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "@/infrastructure/database/client";
import { createInstallationRepository } from "@/infrastructure/database/repositories/installation-repository";

describe("single organization installation", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let repository: ReturnType<typeof createInstallationRepository>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie")
      .withDatabase("installation_test").withUsername("agent_memory").withPassword("agent_memory").start();
    const database = createDatabase(container.getConnectionUri());
    pool = database.pool;
    repository = createInstallationRepository(database.db);
    await migrate(database.db, { migrationsFolder: "drizzle" });
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE organizations, users CASCADE");
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  async function user() {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Test user')", [id, `${id}@example.com`]);
    return id;
  }

  it("creates exactly one organization under concurrent startup", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.initialize()));
    expect(new Set(results.map((organization) => organization.id)).size).toBe(1);
    expect(results[0]).toMatchObject({ slug: "default", name: "Agent Memory", newMemberStatus: "pending" });
    expect((await pool.query("SELECT count(*)::int AS count FROM organizations")).rows).toEqual([{ count: 1 }]);
  });

  it("preserves the existing organization identity and settings", async () => {
    const id = randomUUID();
    await pool.query("INSERT INTO organizations(id,slug,name,new_member_status) VALUES($1,'existing','Existing','active')", [id]);
    expect(await repository.initialize()).toMatchObject({ id, slug: "existing", name: "Existing", newMemberStatus: "active" });
  });

  it("rejects multiple organizations without changing either", async () => {
    await pool.query("INSERT INTO organizations(slug,name) VALUES('first','First'),('second','Second')");
    const before = await pool.query("SELECT * FROM organizations ORDER BY slug");
    await expect(repository.initialize()).rejects.toThrow("requires a single organization");
    expect((await pool.query("SELECT * FROM organizations ORDER BY slug")).rows).toEqual(before.rows);
  });

  it("bootstraps only one owner during concurrent administrator logins", async () => {
    const ids = await Promise.all([user(), user(), user()]);
    await Promise.all(ids.map((id) => repository.enrollUser(id, true)));
    const memberships = (await pool.query("SELECT role,status FROM organization_members")).rows;
    expect(memberships.filter((member) => member.role === "owner")).toEqual([{ role: "owner", status: "active" }]);
    expect(memberships.filter((member) => member.role === "member")).toEqual([
      { role: "member", status: "pending" }, { role: "member", status: "pending" }
    ]);
  });

  it("keeps ordinary users pending and assigns the default team only on activation", async () => {
    const organization = await repository.initialize();
    const teamId = randomUUID();
    await pool.query("INSERT INTO teams(id,organization_id,slug,name) VALUES($1,$2,'default','Default')", [teamId, organization.id]);
    await pool.query("UPDATE organizations SET default_team_id=$1 WHERE id=$2", [teamId, organization.id]);
    const pendingUser = await user();
    await repository.enrollUser(pendingUser, false);
    expect((await pool.query("SELECT status FROM organization_members WHERE user_id=$1", [pendingUser])).rows).toEqual([{ status: "pending" }]);
    expect((await pool.query("SELECT * FROM team_members")).rowCount).toBe(0);
    const admin = await user();
    await repository.enrollUser(admin, true);
    await repository.enrollUser(admin, true);
    expect((await pool.query("SELECT user_id,team_id FROM team_members")).rows).toEqual([{ user_id: admin, team_id: teamId }]);
  });

  it.each(["blocked", "removed"])("preserves %s access even for an administrator", async (status) => {
    const organization = await repository.initialize();
    const id = await user();
    await pool.query("INSERT INTO organization_members(organization_id,user_id,status) VALUES($1,$2,$3)", [organization.id,id,status]);
    await repository.enrollUser(id, true);
    expect((await pool.query("SELECT role,status FROM organization_members WHERE user_id=$1", [id])).rows).toEqual([{ role: "member", status }]);
  });
});
