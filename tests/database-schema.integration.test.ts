import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  type AgentMemoryDatabase
} from "@/infrastructure/database/client";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createAuth } from "@/lib/create-auth";

const organizationA = "00000000-0000-0000-0000-000000000001";
const organizationB = "00000000-0000-0000-0000-000000000002";
const userA = "10000000-0000-0000-0000-000000000001";
const teamB = "20000000-0000-0000-0000-000000000002";

describe("PostgreSQL schema", () => {
  let container: StartedPostgreSqlContainer;
  let db: AgentMemoryDatabase;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      "pgvector/pgvector:0.8.6-pg18-trixie"
    )
      .withDatabase("agent_memory_test")
      .withUsername("agent_memory")
      .withPassword("agent_memory")
      .start();
    const database = createDatabase(container.getConnectionUri());
    db = database.db;
    pool = database.pool;
    await migrate(db, { migrationsFolder: "drizzle" });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("runs on PostgreSQL 18 with pgvector enabled", async () => {
    const result = await pool.query<{
      postgresVersion: string;
      vectorVersion: string;
    }>(
      `SELECT current_setting('server_version') AS "postgresVersion",
              extversion AS "vectorVersion"
       FROM pg_extension
       WHERE extname = 'vector'`
    );

    expect(result.rows[0]?.postgresVersion).toMatch(/^18\./);
    expect(result.rows[0]?.vectorVersion).toBe("0.8.6");
  });

  it("creates a Better Auth session backed by UUID tables", async () => {
    const testAuth = createAuth({
      baseURL: "http://localhost:3100",
      database: db,
      secret: "agent-memory-integration-secret-00000000",
      emailAndPassword: { allowSignUp: true },
      includeNextCookies: false
    });
    const email = "auth-user@example.com";
    const signUpResponse = await testAuth.handler(
      new Request("http://localhost:3100/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3100"
        },
        body: JSON.stringify({
          email,
          name: "Auth User",
          password: "correct-horse-battery-staple"
        })
      })
    );

    expect(signUpResponse.status).toBe(200);
    const cookie = signUpResponse.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    const sessionResponse = await testAuth.handler(
      new Request("http://localhost:3100/api/auth/get-session", {
        headers: { cookie }
      })
    );
    const session = (await sessionResponse.json()) as {
      user?: { email?: string; id?: string };
    };

    expect(sessionResponse.status).toBe(200);
    expect(session.user?.email).toBe(email);
    expect(session.user?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const persisted = await pool.query<{ sessionCount: string }>(
      `SELECT count(*) AS "sessionCount"
       FROM auth_sessions sessions
       JOIN users ON users.id = sessions.user_id
       WHERE users.email = $1`,
      [email]
    );
    expect(persisted.rows[0]?.sessionCount).toBe("1");
  });

  it("loads organization and team membership through the repository", async () => {
    const organization = "00000000-0000-0000-0000-000000000003";
    const user = "10000000-0000-0000-0000-000000000003";
    const team = "20000000-0000-0000-0000-000000000003";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-c', 'Organization C')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-c@example.com', 'User C')`,
      [user]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [organization, user]
    );
    await pool.query(
      `INSERT INTO teams (id, organization_id, slug, name)
       VALUES ($1, $2, 'team-c', 'Team C')`,
      [team, organization]
    );
    await pool.query(
      `INSERT INTO team_members (organization_id, team_id, user_id, role)
       VALUES ($1, $2, $3, 'manager')`,
      [organization, team, user]
    );

    const repository = createOrganizationAccessRepository(db);

    await expect(repository.findByUser(organization, user)).resolves.toEqual({
      organizationId: organization,
      userId: user,
      role: "admin",
      teams: [{ teamId: team, role: "manager" }]
    });
    await expect(
      repository.findByUser(organizationB, user)
    ).resolves.toBeNull();
  });

  it("rejects a memory that points to a team in another organization", async () => {
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-a', 'Organization A'),
              ($2, 'organization-b', 'Organization B')`,
      [organizationA, organizationB]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-a@example.com', 'User A')`,
      [userA]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2)`,
      [organizationA, userA]
    );
    await pool.query(
      `INSERT INTO teams (id, organization_id, slug, name)
       VALUES ($1, $2, 'team-b', 'Team B')`,
      [teamB, organizationB]
    );

    await expect(
      pool.query(
        `INSERT INTO memories (
           organization_id, scope_kind, team_id, kind, title, content,
           source_type, created_by
         ) VALUES ($1, 'team', $2, 'decision', 'Cross-tenant', 'Forbidden', 'user', $3)`,
        [organizationA, teamB, userA]
      )
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "memories_organization_team_fk"
    });
  });
});
