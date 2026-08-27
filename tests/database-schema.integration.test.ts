import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabase,
  type AgentMemoryDatabase
} from "@/infrastructure/database/client";
import { knowledgeNodeMerges } from "@/infrastructure/database/schema";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createOrganizationAdministrationRepository } from "@/infrastructure/database/repositories/organization-administration-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
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
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import {
  createOrganization,
  createTeam
} from "@/domain/identity/organization-administration";
import {
  createPgBossDocumentIngestionQueue,
  documentKnowledgeEnrichmentQueueName,
  documentIngestionQueueName,
  type DocumentKnowledgeEnrichmentJob,
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
      await queue.enqueueKnowledgeEnrichment(organizationId, documentId);
      await queue.enqueueKnowledgeEnrichment(organizationId, documentId);

      const jobs = await boss.findJobs<DocumentIngestionJob>(
        documentIngestionQueueName,
        { data: { organizationId, documentId } }
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.data).toEqual({ organizationId, documentId });
      const enrichmentJobs =
        await boss.findJobs<DocumentKnowledgeEnrichmentJob>(
          documentKnowledgeEnrichmentQueueName,
          { data: { organizationId, documentId } }
        );
      expect(enrichmentJobs).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await queue.stop();
    }
  });

  it("creates a Better Auth session backed by UUID tables", async () => {
    const testAuth = createAuth({
      allowedEmailDomains: ["example.com"],
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

    const signOutResponse = await testAuth.handler(
      new Request("http://localhost:3100/api/auth/sign-out", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: "http://localhost:3100"
        },
        body: "{}"
      })
    );
    expect(signOutResponse.status).toBe(200);
    expect(signOutResponse.headers.getSetCookie()).not.toHaveLength(0);

    const signedOutSessionResponse = await testAuth.handler(
      new Request("http://localhost:3100/api/auth/get-session", {
        headers: { cookie }
      })
    );
    expect(await signedOutSessionResponse.json()).toBeNull();

    const blockedSignUpResponse = await testAuth.handler(
      new Request("http://localhost:3100/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3100"
        },
        body: JSON.stringify({
          email: "blocked-auth-user@outside.test",
          name: "Blocked Auth User",
          password: "correct-horse-battery-staple"
        })
      })
    );

    expect(blockedSignUpResponse.status).toBe(403);
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

    await expect(repository.listByUser(user)).resolves.toEqual([
      {
        id: organization,
        slug: "organization-c",
        name: "Organization C",
        role: "admin"
      }
    ]);
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

  it("bootstraps organizations, members, and teams transactionally", async () => {
    const organizationId = "00000000-0000-0000-0000-000000000011";
    const ownerId = "10000000-0000-0000-0000-000000000011";
    const memberId = "10000000-0000-0000-0000-000000000012";
    const teamId = "20000000-0000-0000-0000-000000000011";
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'owner-k@example.com', 'Owner K'),
              ($2, 'member-k@example.com', 'Member K')`,
      [ownerId, memberId]
    );
    const administration = createOrganizationAdministrationRepository(db);
    const organization = createOrganization({
      id: organizationId,
      slug: "organization-k",
      name: "Organization K",
      now: createdAt
    });

    await expect(
      administration.createOrganization(organization, ownerId)
    ).resolves.toMatchObject({ status: "created", organization });
    await expect(
      administration.createOrganization(organization, ownerId)
    ).resolves.toEqual({ status: "slug_conflict" });
    await expect(
      administration.upsertOrganizationMember(
        organizationId,
        "member-k@example.com",
        "member"
      )
    ).resolves.toMatchObject({ status: "saved", member: { userId: memberId } });
    const team = createTeam({
      id: teamId,
      organizationId,
      slug: "team-k",
      name: "Team K",
      now: createdAt
    });
    await expect(administration.createTeam(team)).resolves.toMatchObject({
      status: "created",
      team
    });
    await expect(
      administration.upsertTeamMember(
        organizationId,
        teamId,
        "member-k@example.com",
        "manager"
      )
    ).resolves.toMatchObject({
      status: "saved",
      member: { userId: memberId, role: "manager" }
    });

    const accessRepository = createOrganizationAccessRepository(db);
    await expect(
      accessRepository.findByUser(organizationId, ownerId)
    ).resolves.toMatchObject({ role: "owner" });
    await expect(
      accessRepository.findByUser(organizationId, memberId)
    ).resolves.toMatchObject({
      role: "member",
      teams: [{ teamId, role: "manager" }]
    });
    await expect(
      administration.upsertOrganizationMember(
        organizationId,
        "owner-k@example.com",
        "member"
      )
    ).resolves.toEqual({ status: "owner_immutable" });

    await expect(
      administration.upsertOrganizationMember(
        organizationId,
        "member-k@example.com",
        "owner"
      )
    ).resolves.toMatchObject({ status: "saved", member: { role: "owner" } });
    const concurrentDemotions = await Promise.all([
      administration.upsertOrganizationMember(
        organizationId,
        "owner-k@example.com",
        "member"
      ),
      administration.upsertOrganizationMember(
        organizationId,
        "member-k@example.com",
        "member"
      )
    ]);
    expect(concurrentDemotions.map((result) => result.status).sort()).toEqual([
      "owner_immutable",
      "saved"
    ]);
    const ownerCount = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM organization_members
       WHERE organization_id = $1 AND role = 'owner'`,
      [organizationId]
    );
    expect(ownerCount.rows[0]?.total).toBe(1);
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
      accessGrants: [
        { principalKind: "user", userId: otherUser, permission: "read" }
      ],
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
      accessGrants: [
        { principalKind: "user", userId: otherUser, permission: "read" }
      ],
      version: 1
    });

    const lexicalHits = await repository.search({
      access,
      query: "rollback commander",
      now: createdAt,
      limit: 10
    });
    expect(lexicalHits.map((hit) => hit.memory.id)).toContain(memoryId);

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
      accessGrants: [
        { principalKind: "user", userId: otherUser, permission: "write" }
      ],
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
    await expect(repository.findById(organization, memoryId)).resolves.toMatchObject({
      accessGrants: [
        { principalKind: "user", userId: otherUser, permission: "write" }
      ]
    });
    await expect(repository.listVersions(organization, memoryId, 1)).resolves
      .toMatchObject([
        {
          version: 2,
          changeReason: "Approval policy changed",
          accessGrants: [
            { principalKind: "user", userId: otherUser, permission: "write" }
          ]
        }
      ]);
    await expect(
      repository.listVersions(organization, memoryId, 10, 2)
    ).resolves.toMatchObject([
      {
        version: 1,
        accessGrants: [
          { principalKind: "user", userId: otherUser, permission: "read" }
        ]
      }
    ]);

    const versions = await pool.query<{
      accessGrants: unknown;
      changedBy: string;
      version: number;
      status: string;
    }>(
      `SELECT version, status, access_grants AS "accessGrants",
              changed_by AS "changedBy"
       FROM memory_versions
       WHERE memory_id = $1
       ORDER BY version`,
      [memoryId]
    );
    expect(versions.rows).toEqual([
      {
        version: 1,
        status: "active",
        changedBy: user,
        accessGrants: [
          { principalKind: "user", userId: otherUser, permission: "read" }
        ]
      },
      {
        version: 2,
        status: "active",
        changedBy: user,
        accessGrants: [
          { principalKind: "user", userId: otherUser, permission: "write" }
        ]
      }
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
      document: {
        status: "processing",
        processingAttempts: 1
      },
      leaseId: expect.any(String)
    });
    if (!claimed) {
      throw new Error("document was not claimed");
    }
    const reclaimedAt = new Date(createdAt.getTime() + 21 * 60 * 1_000);
    const reclaimed = await repository.claimForProcessing(
      organization,
      documentId,
      reclaimedAt
    );
    expect(reclaimed).toMatchObject({
      document: { processingAttempts: 2 },
      leaseId: expect.not.stringMatching(claimed.leaseId)
    });
    if (!reclaimed) {
      throw new Error("stale document was not reclaimed");
    }
    await expect(
      repository.failProcessing(
        claimed,
        "late failure from stale worker",
        reclaimedAt
      )
    ).resolves.toBe(false);
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
    await expect(
      repository.completeProcessing(claimed, [chunk], reclaimedAt)
    ).rejects.toThrow("document processing claim was lost");
    await repository.completeProcessing(reclaimed, [chunk], reclaimedAt);

    await expect(
      repository.findChunkById(organization, chunk.id)
    ).resolves.toMatchObject({
      document: { id: documentId, status: "ready" },
      chunk: { id: chunk.id, documentId }
    });
    await expect(
      repository.findChunkById(
        "00000000-0000-0000-0000-000000000099",
        chunk.id
      )
    ).resolves.toBeNull();
    await expect(repository.findById(organization, documentId)).resolves.toMatchObject({
      status: "ready",
      processingAttempts: 2,
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

    const candidateRepository = createKnowledgeCandidateRepository(db);
    const candidate = createKnowledgeCandidate({
      id: "80000000-0000-0000-0000-000000000006",
      scope: document.scope,
      documentId,
      chunkId: chunk.id,
      model: "test-extractor",
      graph: {
        entities: [
          {
            key: "commander",
            kind: "role",
            canonicalName: "Incident Commander"
          },
          {
            key: "runbook",
            kind: "document",
            canonicalName: "Incident response"
          }
        ],
        relationships: [
          {
            sourceKey: "commander",
            targetKey: "runbook",
            predicate: "follows"
          }
        ]
      },
      now: createdAt
    });
    await expect(candidateRepository.save(candidate)).resolves.toMatchObject({
      id: candidate.id,
      scope: document.scope,
      status: "pending"
    });
    await expect(
      candidateRepository.save({
        ...candidate,
        id: "80000000-0000-0000-0000-000000000007"
      })
    ).resolves.toMatchObject({ id: candidate.id });
    await expect(
      candidateRepository.findByChunkId(organization, chunk.id)
    ).resolves.toMatchObject({ id: candidate.id, scope: document.scope });
    await expect(
      candidateRepository.findByChunkId(organizationB, chunk.id)
    ).resolves.toBeNull();
    await expect(
      candidateRepository.listPending(
        {
          organizationId: organization,
          userId: user,
          role: "member",
          teams: [{ teamId: team, role: "manager" }]
        },
        10
      )
    ).resolves.toMatchObject([{ id: candidate.id }]);
    await expect(
      candidateRepository.listPending(
        {
          organizationId: organization,
          userId: otherUser,
          role: "member",
          teams: []
        },
        10
      )
    ).resolves.toEqual([]);
    const graphSourceMemoryId = "30000000-0000-0000-0000-000000000061";
    const memoryRepository = createMemoryRepository(db);
    await memoryRepository.save(
      createMemory({
        id: graphSourceMemoryId,
        kind: "fact",
        scope: document.scope,
        title: "Incident commander",
        content: "The incident commander follows the response runbook.",
        source: { type: "user" },
        createdBy: user,
        validFrom: createdAt,
        now: createdAt
      })
    );
    await createKnowledgeGraphRepository(db).saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000060",
        scope: document.scope,
        kind: "role",
        canonicalName: "Incident Commander",
        source: { memoryId: graphSourceMemoryId },
        now: createdAt
      })
    );
    const promotion = await candidateRepository.accept({
      candidateId: candidate.id,
      organizationId: organization,
      entityPromotions: [
        {
          key: "commander",
          id: "60000000-0000-0000-0000-000000000061"
        },
        {
          key: "runbook",
          id: "60000000-0000-0000-0000-000000000062"
        }
      ],
      relationshipIds: ["70000000-0000-0000-0000-000000000061"],
      reviewedAt: createdAt,
      reviewedBy: user,
      reason: "Verified against the source chunk"
    });
    expect(promotion).toMatchObject({
      candidate: {
        id: candidate.id,
        status: "accepted",
        reviewedBy: user,
        reviewReason: "Verified against the source chunk"
      },
      nodes: [
        {
          sources: expect.arrayContaining([
            { memoryId: graphSourceMemoryId },
            { chunkId: chunk.id }
          ])
        },
        { sources: [{ chunkId: chunk.id }] }
      ],
      edges: [{ sources: [{ chunkId: chunk.id }], predicate: "follows" }]
    });
    await expect(
      candidateRepository.accept({
        candidateId: candidate.id,
        organizationId: organization,
        entityPromotions: [],
        relationshipIds: [],
        reviewedAt: createdAt,
        reviewedBy: user
      })
    ).resolves.toMatchObject({ candidate: { status: "accepted" } });
    await expect(
      candidateRepository.reject({
        candidateId: candidate.id,
        organizationId: organization,
        reviewedAt: createdAt,
        reviewedBy: user
      })
    ).resolves.toBeNull();

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
    await expect(
      repository.archive(organization, documentId, createdAt)
    ).resolves.toBe(true);
    await expect(repository.findById(organization, documentId)).resolves.toMatchObject({
      status: "archived"
    });
    await expect(
      repository.search({ access, query: "rollback", limit: 10 })
    ).resolves.toEqual([]);
    await expect(
      candidateRepository.accept({
        candidateId: candidate.id,
        organizationId: organization,
        entityPromotions: [],
        relationshipIds: [],
        reviewedAt: createdAt,
        reviewedBy: user
      })
    ).resolves.toBeNull();
  });

  it("upserts, searches, and traverses only accessible knowledge", async () => {
    const organization = "00000000-0000-0000-0000-000000000009";
    const user = "10000000-0000-0000-0000-000000000009";
    const otherUser = "10000000-0000-0000-0000-000000000010";
    const team = "20000000-0000-0000-0000-000000000009";
    const sourceNodeId = "60000000-0000-0000-0000-000000000009";
    const targetNodeId = "60000000-0000-0000-0000-000000000010";
    const sourceMemoryId = "30000000-0000-0000-0000-000000000091";
    const corroboratingMemoryId = "30000000-0000-0000-0000-000000000092";
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
    const memoryRepository = createMemoryRepository(db);
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    const scope = { kind: "team" as const, organizationId: organization, teamId: team };
    for (const [id, title] of [
      [sourceMemoryId, "Checkout topology"],
      [corroboratingMemoryId, "Orders topology"]
    ] as const) {
      await memoryRepository.save(
        createMemory({
          id,
          kind: "fact",
          scope,
          title,
          content: "Checkout API depends on the Orders Database.",
          source: { type: "user" },
          createdBy: user,
          validFrom: createdAt,
          now: createdAt
        })
      );
    }
    const sourceNode = createKnowledgeNode({
      id: sourceNodeId,
      scope,
      kind: "service",
      canonicalName: "Checkout API",
      summary: "Processes checkout requests",
      embedding: { model: "test-embedding", values: [1, 0, 0] },
      source: { memoryId: sourceMemoryId },
      now: createdAt
    });
    const targetNode = createKnowledgeNode({
      id: targetNodeId,
      scope,
      kind: "database",
      canonicalName: "Orders Database",
      summary: "Stores checkout orders",
      source: { memoryId: sourceMemoryId },
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
        source: { memoryId: corroboratingMemoryId },
        now: new Date("2026-08-27T00:00:00.000Z")
      })
    );
    expect(upserted).toMatchObject({
      id: sourceNodeId,
      summary: "Processes purchases and checkout requests",
      sources: expect.arrayContaining([
        { memoryId: sourceMemoryId },
        { memoryId: corroboratingMemoryId }
      ])
    });
    await expect(
      pool.query(
        `INSERT INTO knowledge_node_sources (organization_id, node_id)
         VALUES ($1, $2)`,
        [organization, sourceNodeId]
      )
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "knowledge_node_sources_exactly_one_source_check"
    });

    const edge = createKnowledgeEdge({
      id: "70000000-0000-0000-0000-000000000009",
      organizationId: organization,
      scope,
      sourceNodeId,
      targetNodeId,
      predicate: "depends_on",
      source: { memoryId: corroboratingMemoryId },
      now: createdAt
    });
    await repository.saveEdge(edge);

    const normalizedRecognition = await repository.saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000011",
        scope,
        kind: "award",
        canonicalName: "ＡＷＳ  AI Hero",
        source: { memoryId: sourceMemoryId },
        now: createdAt
      })
    );
    const repeatedRecognition = await repository.saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000012",
        scope,
        kind: "designation",
        canonicalName: "aws ai hero",
        source: { memoryId: corroboratingMemoryId },
        now: createdAt
      })
    );
    expect(repeatedRecognition).toMatchObject({
      id: normalizedRecognition.id,
      kind: "recognition",
      sources: expect.arrayContaining([
        { memoryId: sourceMemoryId },
        { memoryId: corroboratingMemoryId }
      ])
    });

    const duplicateNode = await repository.saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000013",
        scope,
        kind: "concept",
        canonicalName: "Checkout API",
        source: { memoryId: corroboratingMemoryId },
        now: createdAt
      })
    );
    const duplicateEdge = await repository.saveEdge(
      createKnowledgeEdge({
        id: "70000000-0000-0000-0000-000000000011",
        organizationId: organization,
        scope,
        sourceNodeId: duplicateNode.id,
        targetNodeId,
        predicate: "depends_on",
        source: { memoryId: sourceMemoryId },
        now: createdAt
      })
    );
    const selfCollapsingEdge = await repository.saveEdge(
      createKnowledgeEdge({
        id: "70000000-0000-0000-0000-000000000012",
        organizationId: organization,
        scope,
        sourceNodeId: duplicateNode.id,
        targetNodeId: sourceNodeId,
        predicate: "same_as",
        source: { memoryId: sourceMemoryId },
        now: createdAt
      })
    );
    await expect(
      repository.mergeNodes({
        organizationId: organization,
        sourceNodeId: duplicateNode.id,
        targetNodeId: sourceNodeId,
        mergedBy: user,
        reason: "Same service extracted with a different kind",
        now: createdAt
      })
    ).resolves.toMatchObject({
      id: sourceNodeId,
      sources: expect.arrayContaining([
        { memoryId: sourceMemoryId },
        { memoryId: corroboratingMemoryId }
      ])
    });
    await expect(
      repository.findNodeById(organization, duplicateNode.id)
    ).resolves.toBeNull();
    await expect(
      repository.findEdgeById(organization, duplicateEdge.id)
    ).resolves.toBeNull();
    await expect(
      repository.findEdgeById(organization, selfCollapsingEdge.id)
    ).resolves.toBeNull();
    const mergeAuditRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeNodeMerges)
      .where(eq(knowledgeNodeMerges.organizationId, organization));
    expect(mergeAuditRows[0]?.count).toBe(1);

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

    await pool.query(
      `UPDATE memories SET status = 'archived'
       WHERE organization_id = $1 AND id IN ($2, $3)`,
      [organization, sourceMemoryId, corroboratingMemoryId]
    );
    await expect(
      repository.searchNodes({ access, query: "checkout", limit: 10 })
    ).resolves.toEqual([]);
    await expect(
      repository.findNeighborhood(access, sourceNodeId, 2, 10)
    ).resolves.toEqual({ nodes: [], edges: [] });
    await expect(
      repository.findEdgeById(organization, edge.id)
    ).resolves.toMatchObject({ id: edge.id });
    await expect(repository.deleteEdge(organization, edge.id)).resolves.toBe(true);
    await expect(repository.findEdgeById(organization, edge.id)).resolves.toBeNull();
    const cascadingEdge = createKnowledgeEdge({
      ...edge,
      id: "70000000-0000-0000-0000-000000000010",
      source: { memoryId: corroboratingMemoryId },
      now: createdAt
    });
    await repository.saveEdge(cascadingEdge);
    await expect(repository.deleteNode(organization, sourceNodeId)).resolves.toBe(true);
    await expect(
      repository.findNodeById(organization, sourceNodeId)
    ).resolves.toBeNull();
    await expect(
      repository.findEdgeById(organization, cascadingEdge.id)
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
