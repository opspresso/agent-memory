import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  type AgentMemoryDatabase
} from "@/infrastructure/database/client";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createAuth } from "@/lib/create-auth";
import { createMemory, reviseMemory } from "@/domain/memory/memory";
import {
  createDocument,
  createDocumentChunk
} from "@/domain/document/document";
import {
  createKnowledgeEdge,
  createKnowledgeNode
} from "@/domain/knowledge/knowledge-graph";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import {
  createPgBossDocumentIngestionQueue,
  documentIngestionQueueName,
  type DocumentIngestionJob
} from "@/infrastructure/queue/document-ingestion-queue";

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

  it("deduplicates document ingestion jobs in pg-boss", async () => {
    const errors: Error[] = [];
    const queue = createPgBossDocumentIngestionQueue(
      container.getConnectionUri(),
      (error) => errors.push(error)
    );

    try {
      const boss = await queue.start();
      const organizationId = "00000000-0000-0000-0000-000000000008";
      const documentId = "40000000-0000-0000-0000-000000000008";
      await queue.enqueue(organizationId, documentId);
      await queue.enqueue(organizationId, documentId);

      const jobs = await boss.findJobs<DocumentIngestionJob>(
        documentIngestionQueueName,
        { data: { organizationId, documentId } }
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.data).toEqual({ organizationId, documentId });
      expect(errors).toEqual([]);
    } finally {
      await queue.stop();
    }
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
    const bearerToken = signUpResponse.headers.get("set-auth-token");
    expect(bearerToken).toBeTruthy();
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

    const bearerSessionResponse = await testAuth.handler(
      new Request("http://localhost:3100/api/auth/get-session", {
        headers: { authorization: `Bearer ${bearerToken}` }
      })
    );
    const bearerSession = (await bearerSessionResponse.json()) as {
      user?: { email?: string };
    };
    expect(bearerSession.user?.email).toBe(email);

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

  it("persists revisions and searches only accessible active memory", async () => {
    const organization = "00000000-0000-0000-0000-000000000004";
    const user = "10000000-0000-0000-0000-000000000004";
    const otherUser = "10000000-0000-0000-0000-000000000005";
    const team = "20000000-0000-0000-0000-000000000004";
    const memoryId = "30000000-0000-0000-0000-000000000004";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-d', 'Organization D')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-d@example.com', 'User D'),
              ($2, 'user-e@example.com', 'User E')`,
      [user, otherUser]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [organization, user, otherUser]
    );
    await pool.query(
      `INSERT INTO teams (id, organization_id, slug, name)
       VALUES ($1, $2, 'team-d', 'Team D')`,
      [team, organization]
    );
    await pool.query(
      `INSERT INTO team_members (organization_id, team_id, user_id, role)
       VALUES ($1, $2, $3, 'manager')`,
      [organization, team, user]
    );

    const repository = createMemoryRepository(db);
    const access: OrganizationAccess = {
      organizationId: organization,
      userId: user,
      role: "member",
      teams: [{ teamId: team, role: "manager" }]
    };
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    const original = createMemory({
      id: memoryId,
      kind: "decision",
      scope: { kind: "team", organizationId: organization, teamId: team },
      title: "Rollback policy",
      content: "Production rollback requires an incident commander.",
      source: {
        type: "agent",
        agentId: "incident-agent",
        metadata: { conversationId: "conversation-42" }
      },
      embedding: { model: "test-embedding", values: [1, 0, 0] },
      createdBy: user,
      validFrom: createdAt,
      now: createdAt
    });

    await repository.save(original);
    await expect(repository.findById(organization, memoryId)).resolves.toMatchObject({
      id: memoryId,
      source: {
        type: "agent",
        agentId: "incident-agent",
        metadata: { conversationId: "conversation-42" }
      },
      embedding: { model: "test-embedding", values: [1, 0, 0] },
      version: 1
    });

    const lexicalHits = await repository.search({
      access,
      query: "rollback commander",
      now: createdAt,
      limit: 10
    });
    expect(lexicalHits.map((hit) => hit.memory.id)).toContain(memoryId);

    const inaccessibleHits = await repository.search({
      access: {
        organizationId: organization,
        userId: otherUser,
        role: "member",
        teams: []
      },
      query: "rollback commander",
      now: createdAt,
      limit: 10
    });
    expect(inaccessibleHits).toEqual([]);

    await pool.query(
      `INSERT INTO memory_access_grants (
         organization_id, memory_id, principal_kind, user_id, permission, granted_by
       ) VALUES ($1, $2, 'user', $3, 'read', $4)`,
      [organization, memoryId, otherUser, user]
    );
    const explicitlyGrantedHits = await repository.search({
      access: {
        organizationId: organization,
        userId: otherUser,
        role: "member",
        teams: []
      },
      query: "rollback commander",
      now: createdAt,
      limit: 10
    });
    expect(explicitlyGrantedHits.map((hit) => hit.memory.id)).toEqual([
      memoryId
    ]);

    const revised = reviseMemory(original, {
      content: "Production rollback requires two approvers.",
      embedding: { model: "test-embedding", values: [0.9, 0.1, 0] },
      now: new Date("2026-08-27T00:00:00.000Z")
    });
    await expect(
      repository.saveRevision(revised, 1, user, "Approval policy changed")
    ).resolves.toBe("saved");
    await expect(
      repository.saveRevision(revised, 1, user, "Stale update")
    ).resolves.toBe("conflict");

    const hybridHits = await repository.search({
      access,
      query: "unrelated lexical query",
      queryEmbedding: { model: "test-embedding", values: [1, 0, 0] },
      now: new Date("2026-08-27T00:00:00.000Z"),
      limit: 10
    });
    expect(hybridHits[0]).toMatchObject({
      memory: { id: memoryId, version: 2 },
      vectorScore: expect.any(Number),
      score: expect.any(Number)
    });

    const versions = await pool.query<{
      changedBy: string;
      version: number;
      status: string;
    }>(
      `SELECT version, status, changed_by AS "changedBy"
       FROM memory_versions
       WHERE memory_id = $1
       ORDER BY version`,
      [memoryId]
    );
    expect(versions.rows).toEqual([
      { version: 1, status: "active", changedBy: user },
      { version: 2, status: "active", changedBy: user }
    ]);
  });

  it("claims, indexes, and scope-filters RAG documents", async () => {
    const organization = "00000000-0000-0000-0000-000000000006";
    const user = "10000000-0000-0000-0000-000000000006";
    const otherUser = "10000000-0000-0000-0000-000000000007";
    const team = "20000000-0000-0000-0000-000000000006";
    const documentId = "40000000-0000-0000-0000-000000000006";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-f', 'Organization F')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-f@example.com', 'User F'),
              ($2, 'user-g@example.com', 'User G')`,
      [user, otherUser]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [organization, user, otherUser]
    );
    await pool.query(
      `INSERT INTO teams (id, organization_id, slug, name)
       VALUES ($1, $2, 'team-f', 'Team F')`,
      [team, organization]
    );
    await pool.query(
      `INSERT INTO team_members (organization_id, team_id, user_id)
       VALUES ($1, $2, $3)`,
      [organization, team, user]
    );

    const repository = createDocumentRepository(db);
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    const document = createDocument({
      id: documentId,
      scope: { kind: "team", organizationId: organization, teamId: team },
      title: "Incident response",
      objectKey: `organizations/${organization}/documents/${documentId}/source`,
      checksum: "b".repeat(64),
      mimeType: "text/markdown",
      sizeBytes: 128,
      createdBy: user,
      now: createdAt
    });
    await repository.save(document);

    const claimed = await repository.claimForProcessing(
      organization,
      documentId,
      createdAt
    );
    expect(claimed).toMatchObject({
      status: "processing",
      processingAttempts: 1
    });
    if (!claimed) {
      throw new Error("document was not claimed");
    }
    const chunk = createDocumentChunk({
      id: "50000000-0000-0000-0000-000000000006",
      organizationId: organization,
      documentId,
      ordinal: 0,
      content: "Rollback requires an incident commander and two approvers.",
      embedding: { model: "test-embedding", values: [1, 0, 0] },
      metadata: { start: 0, end: 59 },
      now: createdAt
    });
    await repository.completeProcessing(claimed, [chunk], createdAt);

    await expect(repository.findById(organization, documentId)).resolves.toMatchObject({
      status: "ready",
      processingAttempts: 1,
      sizeBytes: 128
    });
    await expect(
      repository.claimForProcessing(organization, documentId, createdAt)
    ).resolves.toBeNull();

    const access: OrganizationAccess = {
      organizationId: organization,
      userId: user,
      role: "member",
      teams: [{ teamId: team, role: "member" }]
    };
    const lexicalHits = await repository.search({
      access,
      query: "rollback approvers",
      limit: 10
    });
    expect(lexicalHits[0]).toMatchObject({
      document: { id: documentId },
      chunk: { content: expect.stringContaining("incident commander") }
    });
    const hybridHits = await repository.search({
      access,
      query: "unrelated terms",
      queryEmbedding: { model: "test-embedding", values: [1, 0, 0] },
      limit: 10
    });
    expect(hybridHits[0]).toMatchObject({
      document: { id: documentId },
      vectorScore: expect.any(Number)
    });
    await expect(
      repository.search({
        access: {
          organizationId: organization,
          userId: otherUser,
          role: "member",
          teams: []
        },
        query: "rollback approvers",
        limit: 10
      })
    ).resolves.toEqual([]);

    await repository.save(
      createDocument({
        id: "40000000-0000-0000-0000-000000000007",
        scope: {
          kind: "user",
          organizationId: organization,
          userId: otherUser
        },
        title: "Personal copy",
        objectKey: `organizations/${organization}/documents/personal/source`,
        checksum: document.checksum,
        mimeType: "text/markdown",
        sizeBytes: 128,
        createdBy: otherUser,
        now: createdAt
      })
    );
  });

  it("upserts, searches, and traverses only accessible knowledge", async () => {
    const organization = "00000000-0000-0000-0000-000000000009";
    const user = "10000000-0000-0000-0000-000000000009";
    const otherUser = "10000000-0000-0000-0000-000000000010";
    const team = "20000000-0000-0000-0000-000000000009";
    const sourceNodeId = "60000000-0000-0000-0000-000000000009";
    const targetNodeId = "60000000-0000-0000-0000-000000000010";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-i', 'Organization I')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-i@example.com', 'User I'),
              ($2, 'user-j@example.com', 'User J')`,
      [user, otherUser]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [organization, user, otherUser]
    );
    await pool.query(
      `INSERT INTO teams (id, organization_id, slug, name)
       VALUES ($1, $2, 'team-i', 'Team I')`,
      [team, organization]
    );
    await pool.query(
      `INSERT INTO team_members (organization_id, team_id, user_id)
       VALUES ($1, $2, $3)`,
      [organization, team, user]
    );

    const repository = createKnowledgeGraphRepository(db);
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    const scope = { kind: "team" as const, organizationId: organization, teamId: team };
    const sourceNode = createKnowledgeNode({
      id: sourceNodeId,
      scope,
      kind: "service",
      canonicalName: "Checkout API",
      summary: "Processes checkout requests",
      embedding: { model: "test-embedding", values: [1, 0, 0] },
      now: createdAt
    });
    const targetNode = createKnowledgeNode({
      id: targetNodeId,
      scope,
      kind: "database",
      canonicalName: "Orders Database",
      summary: "Stores checkout orders",
      now: createdAt
    });
    await repository.saveNode(sourceNode);
    await repository.saveNode(targetNode);
    const upserted = await repository.saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000099",
        scope,
        kind: "service",
        canonicalName: "Checkout API",
        summary: "Processes purchases and checkout requests",
        now: new Date("2026-08-27T00:00:00.000Z")
      })
    );
    expect(upserted).toMatchObject({
      id: sourceNodeId,
      summary: "Processes purchases and checkout requests"
    });

    const edge = createKnowledgeEdge({
      id: "70000000-0000-0000-0000-000000000009",
      organizationId: organization,
      scope,
      sourceNodeId,
      targetNodeId,
      predicate: "depends_on",
      now: createdAt
    });
    await repository.saveEdge(edge);

    const access: OrganizationAccess = {
      organizationId: organization,
      userId: user,
      role: "member",
      teams: [{ teamId: team, role: "member" }]
    };
    const hits = await repository.searchNodes({
      access,
      query: "checkout purchases",
      limit: 10
    });
    expect(hits[0]).toMatchObject({
      node: { id: sourceNodeId },
      lexicalScore: expect.any(Number)
    });
    const hybridHits = await repository.searchNodes({
      access,
      query: "unrelated terms",
      queryEmbedding: { model: "test-embedding", values: [1, 0, 0] },
      limit: 10
    });
    expect(hybridHits[0]).toMatchObject({
      node: { id: sourceNodeId },
      vectorScore: expect.any(Number)
    });
    await expect(
      repository.searchNodes({
        access: {
          organizationId: organization,
          userId: otherUser,
          role: "member",
          teams: []
        },
        query: "checkout",
        limit: 10
      })
    ).resolves.toEqual([]);

    await expect(
      repository.findNeighborhood(access, sourceNodeId, 2, 10)
    ).resolves.toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: sourceNodeId }),
        expect.objectContaining({ id: targetNodeId })
      ]),
      edges: [expect.objectContaining({ id: edge.id })]
    });
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
