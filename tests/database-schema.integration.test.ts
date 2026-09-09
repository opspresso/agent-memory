import { checkSchemaReadiness, DatabaseSchemaNotReadyError } from "@/infrastructure/database/schema-readiness";
import { buildCurateKnowledgeCandidate } from "@/application/knowledge/curate-knowledge-candidate";
import { buildAcceptKnowledgeCandidate, buildRejectKnowledgeCandidate } from "@/application/knowledge/review-knowledge-candidate";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { randomUUID, createHash } from "node:crypto";
import { buildCreateMemory } from "@/application/memory/create-memory";
import { buildUploadDocument } from "@/application/document/upload-document";
import { buildRetryDocument } from "@/application/document/retry-document";
import { createIngestionReceiptRepository } from "@/infrastructure/database/repositories/ingestion-receipt-repository";
import { ingestionFingerprint } from "@/lib/ingestion-fingerprint";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createDatabase,
  type AgentMemoryDatabase
} from "@/infrastructure/database/client";
import {
  documents as documentsTable,
  organizations,
  organizationMembers,
  knowledgeNodeMerges
} from "@/infrastructure/database/schema";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createOrganizationAgentTokenRepository } from "@/infrastructure/database/repositories/organization-agent-token-repository";
import { createOrganizationAdministrationRepository } from "@/infrastructure/database/repositories/organization-administration-repository";
import { createMemoryRepository } from "@/infrastructure/database/repositories/memory-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createKnowledgeGraphRepository } from "@/infrastructure/database/repositories/knowledge-graph-repository";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import {
  scopedManagePredicate,
  scopedReadPredicate
} from "@/infrastructure/database/repositories/scope-predicates";
import { createAuth } from "@/lib/create-auth";
import { createMemory, reviseMemory } from "@/domain/memory/memory";
import {
  createDocument,
  createDocumentChunk
} from "@/domain/document/document";
import { documentProcessingLeaseMilliseconds } from "@/domain/document/document-services";
import {
  createKnowledgeEdge,
  createKnowledgeNode
} from "@/domain/knowledge/knowledge-graph";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import {
  defaultKnowledgeOntology,
  defaultKnowledgeOntologyMode
} from "@/domain/knowledge/knowledge-ontology";
import { createKnowledgeTermUsageRepository } from "@/infrastructure/database/repositories/knowledge-term-usage-repository";
import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
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
import { createPostgresAiRequestLimiter } from "@/infrastructure/ai/postgres-request-limiter";
import { createAppSettingsRepository } from "@/infrastructure/database/repositories/app-settings-repository";

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

  async function seedOrganization(organization: ReturnType<typeof createOrganization>, ownerUserId: string) {
    await db.transaction(async (transaction) => {
      await transaction.insert(organizations).values(organization);
      await transaction.insert(organizationMembers).values({ organizationId: organization.id, userId: ownerUserId, role: "owner", status: "active" });
    });
  }

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

    const legacyProvenanceColumns = await pool.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('knowledge_nodes', 'knowledge_edges')
         AND column_name IN ('source_memory_id', 'source_chunk_id')`
    );
    expect(legacyProvenanceColumns.rows).toEqual([]);
  });

  it("rejects a missing migration record or ledger even when the database is reachable", async () => {
    await expect(checkSchemaReadiness(db)).resolves.toBeUndefined();
    const rollback = new Error("rollback readiness fixture");
    await expect(db.transaction(async (transaction) => {
      await transaction.execute(sql`delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)`);
      await expect(checkSchemaReadiness(transaction)).rejects.toBeInstanceOf(DatabaseSchemaNotReadyError);
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(db.transaction(async (transaction) => {
      await transaction.execute(sql`alter table drizzle.__drizzle_migrations rename to readiness_test_migrations`);
      await expect(checkSchemaReadiness(transaction)).rejects.toBeInstanceOf(DatabaseSchemaNotReadyError);
      throw rollback;
    })).rejects.toBe(rollback);
    await expect(checkSchemaReadiness(db)).resolves.toBeUndefined();
  });

  it("stores one global application settings row", async () => {
    const repository = createAppSettingsRepository(db);
    const updatedAt = new Date("2026-09-07T00:00:00.000Z");

    await expect(repository.get()).resolves.toBeNull();
    await expect(
      repository.save({
        overrides: { ALLOWED_EMAIL_DOMAINS: "example.com" },
        updatedAt
      })
    ).resolves.toEqual({
      id: 1,
      overrides: { ALLOWED_EMAIL_DOMAINS: "example.com" },
      updatedAt
    });
    await expect(
      repository.save({
        overrides: { ADMIN_EMAILS: "admin@example.com" },
        updatedAt
      })
    ).resolves.toMatchObject({
      overrides: { ADMIN_EMAILS: "admin@example.com" }
    });
    await expect(
      pool.query(
        `INSERT INTO app_settings (id, overrides) VALUES (2, '{}')`
      )
    ).rejects.toMatchObject({ constraint: "app_settings_singleton_check" });
    await Promise.all([
      repository.update((current) => ({
        overrides: { ...current?.overrides, LOG_LEVEL: "debug" },
        updatedAt
      })),
      repository.update((current) => ({
        overrides: { ...current?.overrides, RERANKER_MIN_SCORE: "0.5" },
        updatedAt
      }))
    ]);
    await expect(repository.get()).resolves.toMatchObject({
      overrides: {
        ADMIN_EMAILS: "admin@example.com",
        LOG_LEVEL: "debug",
        RERANKER_MIN_SCORE: "0.5"
      }
    });
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
      const chunkId = "50000000-0000-4000-8000-000000000008";
      await expect(queue.enqueue(organizationId, documentId)).resolves.toBe(
        "queued"
      );
      await expect(queue.enqueue(organizationId, documentId)).resolves.toBe(
        "already_queued"
      );
      await expect(
        queue.enqueueKnowledgeEnrichment(organizationId, chunkId)
      ).resolves.toBe("queued");
      await expect(
        queue.enqueueKnowledgeEnrichment(organizationId, chunkId)
      ).resolves.toBe("already_queued");

      const jobs = await boss.findJobs<DocumentIngestionJob>(
        documentIngestionQueueName,
        { data: { organizationId, documentId } }
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.data).toEqual({ organizationId, documentId });
      const enrichmentJobs =
        await boss.findJobs<DocumentKnowledgeEnrichmentJob>(
          documentKnowledgeEnrichmentQueueName,
          {
            data: {
              organizationId,
              chunkId
            }
          }
        );
      expect(enrichmentJobs).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await queue.stop();
    }
  });

  it("queues a new retry generation while the previous job is still outstanding", async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    await pool.query("INSERT INTO users (id, email, name) VALUES ($1, $2, 'Retry User')", [userId, `${userId}@example.test`]);
    await seedOrganization(createOrganization({ id: organizationId, slug: `retry-${organizationId}`, name: "Retry", now }), userId);
    const repository = createDocumentRepository(db);
    const document = createDocument({ id: randomUUID(), scope: { kind: "user", organizationId, userId },
      title: "Transcript", objectKey: "retry/source", checksum: "a".repeat(64), mimeType: "text/markdown",
      sizeBytes: 10, createdBy: userId, now });
    await repository.save(document);
    const queue = createPgBossDocumentIngestionQueue(container.getConnectionUri(), () => {});
    try {
      const boss = await queue.start();
      await queue.enqueue(organizationId, document.id, 0);
      const claim = await repository.claimForProcessing(organizationId, document.id, now, 0);
      expect(claim).not.toBeNull();
      await repository.failProcessing(claim!, "temporary extraction failure", now);

      const retry = buildRetryDocument({ repository, queue, clock: () => now,
        receipts: createIngestionReceiptRepository(db), fingerprint: ingestionFingerprint });
      const access: OrganizationAccess = { organizationId, userId, role: "owner", teams: [] };
      const request = { idempotencyKey: "retry-1", expectedAttempts: 1 };
      await retry(access, document.id, request);
      await retry(access, document.id, request);
      const jobs = await boss.findJobs<DocumentIngestionJob>(documentIngestionQueueName,
        { data: { organizationId, documentId: document.id } });
      expect(jobs.map((job) => job.data.expectedAttempts).sort()).toEqual([0, 1]);
      expect(await repository.claimForProcessing(organizationId, document.id, now, 0)).toBeNull();
      const next = await repository.claimForProcessing(organizationId, document.id, now, 1);
      expect(next?.document.processingAttempts).toBe(2);
      await repository.completeProcessing(next!, [], now);
      expect((await repository.findById(organizationId, document.id))?.status).toBe("ready");
    } finally {
      await queue.stop();
    }
  });

  it("shares durable AI request quotas across organization principals", async () => {
    const organizationId = "00000000-0000-0000-0000-000000000029";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'ai-quota', 'AI Quota')`,
      [organizationId]
    );
    let now = Date.parse("2026-09-04T00:00:10.000Z");
    let operations = 0;
    const limiter = createPostgresAiRequestLimiter(db, {
      clock: () => now,
      maximumOrganizationRequestsPerMinute: 2,
      maximumUserRequestsPerMinute: 1
    });
    const execute = (userId: string) =>
      limiter.run(
        async () => {
          operations += 1;
          return operations;
        },
        { organizationId, userId }
      );

    await expect(execute("user-a")).resolves.toBe(1);
    await expect(execute("user-a")).rejects.toMatchObject({
      retryAfterSeconds: 50
    });
    await expect(execute("user-b")).resolves.toBe(2);
    await expect(execute("user-c")).rejects.toMatchObject({
      retryAfterSeconds: 50
    });
    expect(operations).toBe(2);

    now += 60_000;
    await expect(execute("user-a")).resolves.toBe(3);
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
    expect(cookie).toContain("agent-memory.session_token=");
    expect(cookie).not.toContain("better-auth.session_token=");
    const otherAppSession = await testAuth.handler(new Request("http://localhost:3100/api/auth/get-session", {
      headers: { cookie: cookie.replaceAll("agent-memory.", "agent-studio.") }
    }));
    expect(await otherAppSession.json()).toBeNull();
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
        role: "admin",
        status: "active"
      }
    ]);
    await expect(repository.findByUser(organization, user)).resolves.toEqual({
      organizationId: organization,
      userId: user,
      role: "admin",
      teams: [{ teamId: team, role: "manager" }]
    });
    await expect(repository.findBySlug("organization-c", user)).resolves.toEqual({
      organizationId: organization,
      userId: user,
      role: "admin",
      teams: [{ teamId: team, role: "manager" }]
    });
    await expect(
      repository.findByEmail(organization, "user-c@example.com")
    ).resolves.toEqual({
      organizationId: organization,
      userId: user,
      role: "admin",
      teams: [{ teamId: team, role: "manager" }]
    });
    await expect(
      repository.findByEmail(organization, "outsider@example.com")
    ).resolves.toBeNull();
    await expect(
      repository.findByUser(organizationB, user)
    ).resolves.toBeNull();

    await pool.query(
      `UPDATE organization_members
       SET status = 'blocked'
       WHERE organization_id = $1 AND user_id = $2`,
      [organization, user]
    );
    await expect(
      repository.findByEmail(organization, "user-c@example.com")
    ).resolves.toBeNull();
  });

  it("stores one revocable Agent token per organization", async () => {
    const organizationId = "00000000-0000-4000-8000-000000000041";
    const userId = "10000000-0000-4000-8000-000000000041";
    const createdAt = new Date("2026-08-31T00:00:00.000Z");
    await pool.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'agent-token@example.com', 'Agent Token')`,
      [userId]
    );
    await pool.query(
      `INSERT INTO organizations (id, slug, name) VALUES ($1, 'agent-token-org', 'Agent Token Org')`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [organizationId, userId]
    );
    const repository = createOrganizationAgentTokenRepository(db);
    const token = {
      organizationId,
      userId,
      tokenHash: "a".repeat(64),
      encryptedToken: "enc:v1:ciphertext-a",
      masked: "amt_••••1234",
      createdAt
    };

    await repository.save(token);

    await expect(repository.findByOrganizationId(organizationId)).resolves.toEqual(
      token
    );
    await expect(
      repository.findByOrganizationSlug("agent-token-org")
    ).resolves.toEqual(token);

    const rotated = {
      ...token,
      tokenHash: "b".repeat(64),
      encryptedToken: "enc:v1:ciphertext-b",
      createdAt: new Date("2026-08-31T01:00:00.000Z")
    };
    await repository.save(rotated);
    await expect(repository.findByOrganizationId(organizationId)).resolves.toEqual(
      rotated
    );

    await repository.delete(organizationId);
    await expect(repository.findByOrganizationId(organizationId)).resolves.toBeNull();

    await repository.save(rotated);
    await pool.query(
      `DELETE FROM organization_members
       WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );
    await expect(repository.findByOrganizationId(organizationId)).resolves.toBeNull();
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

    await seedOrganization(organization, ownerId);
    await expect(
      administration.addOrganizationMember(
        organizationId,
        "member-k@example.com",
        "member"
      )
    ).resolves.toMatchObject({ status: "added", member: { userId: memberId } });
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
      administration.addOrganizationMember(
        organizationId,
        "owner-k@example.com",
        "member"
      )
    ).resolves.toEqual({ status: "already_member" });

    await expect(
      administration.updateOrganizationMember(organizationId, memberId, {
        role: "owner"
      })
    ).resolves.toMatchObject({ status: "saved", member: { role: "owner" } });
    const concurrentDemotions = await Promise.all([
      administration.updateOrganizationMember(organizationId, ownerId, {
        role: "member"
      }),
      administration.updateOrganizationMember(organizationId, memberId, {
        role: "member"
      })
    ]);
    expect(concurrentDemotions.map((result) => result.status).sort()).toEqual([
      "owner_immutable",
      "saved"
    ]);
    const ownerCount = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM organization_members
       WHERE organization_id = $1 AND role = 'owner' AND status = 'active'`,
      [organizationId]
    );
    expect(ownerCount.rows[0]?.total).toBe(1);

    await administration.updateOrganizationMember(organizationId, ownerId, {
      role: "owner"
    });
    await administration.updateOrganizationMember(organizationId, memberId, {
      role: "owner"
    });
    await expect(
      administration.updateOrganizationMember(organizationId, memberId, {
        status: "blocked"
      })
    ).resolves.toMatchObject({ status: "saved" });
    await expect(
      administration.updateOrganizationMember(organizationId, ownerId, {
        role: "member"
      })
    ).resolves.toEqual({ status: "owner_immutable" });
    await expect(
      administration.updateOrganizationMember(organizationId, memberId, {
        role: "member"
      })
    ).resolves.toMatchObject({ status: "saved" });
  });

  it("stores and reads the organization ontology dictionary and mode", async () => {
    const organizationId = "00000000-0000-0000-0000-000000000031";
    const ownerId = "10000000-0000-0000-0000-000000000031";
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    await pool.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'owner-q@example.com', 'Owner Q')`,
      [ownerId]
    );
    const administration = createOrganizationAdministrationRepository(db);
    const ontologyReader = createKnowledgeOntologyReader(db);
    await seedOrganization(
      createOrganization({
        id: organizationId,
        slug: "organization-q",
        name: "Organization Q",
        now: createdAt
      }),
      ownerId
    );

    await expect(
      administration.findOrganization(organizationId)
    ).resolves.toMatchObject({
      ontologyMode: defaultKnowledgeOntologyMode,
      ontology: defaultKnowledgeOntology
    });

    await expect(
      administration.updateOrganizationSettings(
        organizationId,
        {
          ontologyMode: "strict",
          ontology: {
            nodeKinds: ["service", "database"],
            edgePredicates: ["depends_on"]
          }
        },
        createdAt
      )
    ).resolves.toMatchObject({
      status: "updated",
      organization: {
        ontologyMode: "strict",
        ontology: {
          nodeKinds: ["service", "database"],
          edgePredicates: ["depends_on"]
        }
      }
    });

    await expect(
      ontologyReader.findByOrganization(organizationId)
    ).resolves.toEqual({
      mode: "strict",
      ontology: {
        nodeKinds: ["service", "database"],
        edgePredicates: ["depends_on"]
      }
    });
    await expect(
      ontologyReader.findByOrganization("00000000-0000-0000-0000-0000000000ff")
    ).resolves.toBeNull();
  });

  it("aggregates ontology term usage from graph rows and pending candidates", async () => {
    const organization = "00000000-0000-0000-0000-000000000061";
    const user = "10000000-0000-0000-0000-000000000061";
    const documentId = "40000000-0000-0000-0000-000000000061";
    const chunkId = "50000000-0000-0000-0000-000000000061";
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-u', 'Organization U')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-u@example.com', 'User U')`,
      [user]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2)`,
      [organization, user]
    );
    const documentRepository = createDocumentRepository(db);
    await documentRepository.save({
      ...createDocument({
        id: documentId,
        scope: { kind: "organization", organizationId: organization },
        title: "Usage fixture",
        objectKey: `organizations/${organization}/documents/${documentId}/source`,
        checksum: "d".repeat(64),
        mimeType: "text/plain",
        sizeBytes: 16,
        createdBy: user,
        now: createdAt
      })
    });
    await pool.query(
      `INSERT INTO document_chunks (id, organization_id, document_id, ordinal, content)
       VALUES ($1, $2, $3, 0, 'usage fixture chunk')`,
      [chunkId, organization, documentId]
    );

    const graphRepository = createKnowledgeGraphRepository(db);
    const pipeline = await graphRepository.saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000081",
        scope: { kind: "organization", organizationId: organization },
        kind: "pipeline",
        canonicalName: "Usage Pipeline",
        source: { chunkId },
        now: createdAt
      })
    );
    const warehouse = await graphRepository.saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000082",
        scope: { kind: "organization", organizationId: organization },
        kind: "pipeline",
        canonicalName: "Usage Warehouse",
        source: { chunkId },
        now: createdAt
      })
    );
    await graphRepository.saveEdge(
      createKnowledgeEdge({
        id: "70000000-0000-0000-0000-000000000081",
        organizationId: organization,
        scope: { kind: "organization", organizationId: organization },
        sourceNodeId: pipeline.id,
        targetNodeId: warehouse.id,
        predicate: "stores_in",
        source: { chunkId },
        now: createdAt
      })
    );
    const candidateRepository = createKnowledgeCandidateRepository(db);
    await candidateRepository.save(
      createKnowledgeCandidate({
        id: "80000000-0000-0000-0000-000000000081",
        scope: { kind: "organization", organizationId: organization },
        documentId,
        chunkId,
        model: "usage-model",
        graph: {
          entities: [
            { key: "a", kind: "pipeline", canonicalName: "Ingest Pipeline" },
            { key: "b", kind: "gadget", canonicalName: "Widget" }
          ],
          relationships: [
            { sourceKey: "a", targetKey: "b", predicate: "stores_in" }
          ]
        },
        now: createdAt
      })
    );

    const usageRepository = createKnowledgeTermUsageRepository(db);
    await expect(usageRepository.collect(organization)).resolves.toEqual({
      nodeKinds: [
        { term: "pipeline", count: 3 },
        { term: "gadget", count: 1 }
      ],
      edgePredicates: [{ term: "stores_in", count: 2 }]
    });
    await expect(
      usageRepository.collect("00000000-0000-0000-0000-0000000000ee")
    ).resolves.toEqual({ nodeKinds: [], edgePredicates: [] });
  });

  it("keeps SQL scope predicates equivalent to the domain access policy", async () => {
    const organization = "00000000-0000-0000-0000-000000000051";
    const user = "10000000-0000-0000-0000-000000000051";
    const otherUser = "10000000-0000-0000-0000-000000000052";
    const teamA = "20000000-0000-0000-0000-000000000051";
    const teamB = "20000000-0000-0000-0000-000000000052";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-s', 'Organization S')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-s@example.com', 'User S'),
              ($2, 'user-t@example.com', 'User T')`,
      [user, otherUser]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [organization, user, otherUser]
    );
    await pool.query(
      `INSERT INTO teams (id, organization_id, slug, name)
       VALUES ($1, $3, 'team-s', 'Team S'), ($2, $3, 'team-t', 'Team T')`,
      [teamA, teamB, organization]
    );

    const repository = createDocumentRepository(db);
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    const scopes: readonly (readonly [string, ScopedResource])[] = [
      [
        "40000000-0000-0000-0000-000000000051",
        { kind: "organization", organizationId: organization }
      ],
      [
        "40000000-0000-0000-0000-000000000052",
        { kind: "team", organizationId: organization, teamId: teamA }
      ],
      [
        "40000000-0000-0000-0000-000000000053",
        { kind: "team", organizationId: organization, teamId: teamB }
      ],
      [
        "40000000-0000-0000-0000-000000000054",
        { kind: "user", organizationId: organization, userId: user }
      ],
      [
        "40000000-0000-0000-0000-000000000055",
        { kind: "user", organizationId: organization, userId: otherUser }
      ]
    ];
    for (const [id, scope] of scopes) {
      await repository.save(
        createDocument({
          id,
          scope,
          title: `Scope fixture ${id}`,
          objectKey: `organizations/${organization}/documents/${id}/source`,
          checksum: "c".repeat(64),
          mimeType: "text/plain",
          sizeBytes: 16,
          createdBy: user,
          now: createdAt
        })
      );
    }

    for (const [index, status] of ["ready", "processing", "failed"].entries()) {
      await pool.query("UPDATE documents SET status = $1 WHERE id = $2", [status, scopes[index]![0]]);
    }
    const memoryLibrary = createMemoryRepository(db);
    for (const [id, scope] of scopes) {
      await memoryLibrary.save(createMemory({
        id: id.replace(/^4/, "3"), scope, kind: "fact", title: "Library fixture", content: "Library evidence",
        source: { type: "user" }, createdBy: user, validFrom: createdAt, now: createdAt
      }));
    }

    const accessVariants: readonly OrganizationAccess[] = [
      { organizationId: organization, userId: user, role: "member", teams: [] },
      {
        organizationId: organization,
        userId: user,
        role: "member",
        teams: [{ teamId: teamA, role: "member" }]
      },
      {
        organizationId: organization,
        userId: user,
        role: "member",
        teams: [{ teamId: teamA, role: "manager" }]
      },
      { organizationId: organization, userId: user, role: "admin", teams: [] },
      { organizationId: organization, userId: user, role: "owner", teams: [] },
      {
        organizationId: organization,
        userId: user,
        role: "admin",
        teams: [],
        principalKind: "organization-agent"
      }
    ];
    for (const access of accessVariants) {
      const expectedRead = scopes.filter(([, scope]) => canAccessScopedResource(access, "read", scope)).map(([id]) => id).toSorted().toReversed();
      const documents = await repository.list({ access, limit: 100, offset: 0 });
      expect(documents.map((document) => document.id)).toEqual(expectedRead);
      expect((await repository.list({ access, limit: 1, offset: 1 })).map((document) => document.id)).toEqual(expectedRead.slice(1, 2));
      const memories = await memoryLibrary.list({ access, now: createdAt, limit: 100, offset: 0 });
      expect(memories.map((memory) => memory.id)).toEqual(expectedRead.map((id) => id.replace(/^4/, "3")));
      expect((await memoryLibrary.list({ access, now: createdAt, limit: 1, offset: 1 })).map((memory) => memory.id)).toEqual(expectedRead.slice(1, 2).map((id) => id.replace(/^4/, "3")));
      for (const action of ["read", "manage"] as const) {
        const predicate =
          action === "read"
            ? scopedReadPredicate(access, documentsTable)
            : scopedManagePredicate(access, documentsTable);
        const rows = await db
          .select({ id: documentsTable.id })
          .from(documentsTable)
          .where(
            and(eq(documentsTable.organizationId, organization), predicate)
          );
        const expected = scopes
          .filter(([, scope]) => canAccessScopedResource(access, action, scope))
          .map(([id]) => id)
          .toSorted();
        expect(
          rows.map((row) => row.id).toSorted(),
          `${access.principalKind ?? "user"}:${access.role} teams=${JSON.stringify(access.teams)} action=${action}`
        ).toEqual(expected);
      }
    }
    for (const [id] of scopes) {
      await pool.query("UPDATE documents SET status = 'ready' WHERE id = $1", [id]);
      for (const ordinal of [2, 0, 1]) {
        await pool.query("INSERT INTO document_chunks (id, organization_id, document_id, ordinal, content) VALUES (gen_random_uuid(), $1, $2, $3, $4)", [organization, id, ordinal, `Library passage ${ordinal}`]);
      }
    }
    for (const access of accessVariants) {
      for (const [id, scope] of scopes) {
        const contents = await repository.readChunks({ access, documentId: id, limit: 1, offset: 1 });
        if (canAccessScopedResource(access, "read", scope)) {
          expect(contents?.document.id).toBe(id);
          expect(contents?.chunks.map((chunk) => chunk.ordinal)).toEqual([1]);
          expect(contents?.chunks[0]?.content).toBe("Library passage 1");
          expect((await repository.readChunks({ access, documentId: id, limit: 1, offset: 10 }))?.chunks).toEqual([]);
        } else {
          expect(contents).toBeNull();
        }
      }
    }
    expect(await repository.listChunksByDocument(organization, scopes[0]![0])).toHaveLength(3);
    const owner = accessVariants[4]!;
    const foreignAccess = { ...owner, organizationId: "00000000-0000-0000-0000-000000000099" };
    expect(await repository.list({ access: foreignAccess, limit: 100, offset: 0 })).toEqual([]);
    expect(await repository.readChunks({ access: foreignAccess, documentId: scopes[0]![0], limit: 25, offset: 0 })).toBeNull();
    expect(await memoryLibrary.list({ access: foreignAccess, now: createdAt, limit: 100, offset: 0 })).toEqual([]);
    for (const status of ["pending", "processing", "failed", "archived"]) {
      await pool.query("UPDATE documents SET status = $1 WHERE id = $2", [status, scopes[0]![0]]);
      expect(await repository.readChunks({ access: owner, documentId: scopes[0]![0], limit: 25, offset: 0 })).toBeNull();
    }
    await pool.query("UPDATE documents SET status = 'archived' WHERE id = $1", [scopes[0]![0]]);
    expect((await repository.list({ access: owner, limit: 100, offset: 0 })).some((document) => document.id === scopes[0]![0])).toBe(false);
    await pool.query("UPDATE memories SET valid_from = $1::timestamptz - interval '1 second', expires_at = $1 WHERE id = $2", [createdAt, scopes[0]![0].replace(/^4/, "3")]);
    await pool.query("UPDATE memories SET valid_from = $1 WHERE id = $2", [new Date(createdAt.getTime() + 1), scopes[1]![0].replace(/^4/, "3")]);
    const active = await memoryLibrary.list({ access: owner, now: createdAt, limit: 100, offset: 0 });
    expect(active.map((memory) => memory.id)).not.toContain(scopes[0]![0].replace(/^4/, "3"));
    expect(active.map((memory) => memory.id)).not.toContain(scopes[1]![0].replace(/^4/, "3"));
  });

  it("applies join policy, membership status, and default team assignment", async () => {
    const organizationId = "00000000-0000-0000-0000-000000000021";
    const ownerId = "10000000-0000-0000-0000-000000000021";
    const joinerId = "10000000-0000-0000-0000-000000000022";
    const addedMemberId = "10000000-0000-0000-0000-000000000024";
    const teamId = "20000000-0000-0000-0000-000000000021";
    const otherOrganizationId = "00000000-0000-0000-0000-000000000023";
    const otherOwnerId = "10000000-0000-0000-0000-000000000023";
    const otherTeamId = "20000000-0000-0000-0000-000000000023";
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'owner-p@example.com', 'Owner P'),
              ($2, 'joiner-p@example.com', 'Joiner P'),
              ($3, 'other-owner-p@example.com', 'Other Owner P'),
              ($4, 'added-member-p@example.com', 'Added Member P')`,
      [ownerId, joinerId, otherOwnerId, addedMemberId]
    );
    const administration = createOrganizationAdministrationRepository(db);
    const access = createOrganizationAccessRepository(db);
    await seedOrganization(
      createOrganization({
        id: organizationId,
        slug: "organization-p",
        name: "Organization P",
        now: createdAt
      }),
      ownerId
    );
    await administration.createTeam(
      createTeam({
        id: teamId,
        organizationId,
        slug: "team-p",
        name: "Team P",
        now: createdAt
      })
    );
    await seedOrganization(
      createOrganization({
        id: otherOrganizationId,
        slug: "other-organization-p",
        name: "Other Organization P",
        now: createdAt
      }),
      otherOwnerId
    );
    await administration.createTeam(
      createTeam({
        id: otherTeamId,
        organizationId: otherOrganizationId,
        slug: "other-team-p",
        name: "Other Team P",
        now: createdAt
      })
    );
    await expect(
      pool.query(
        `UPDATE organizations SET default_team_id = $1 WHERE id = $2`,
        [otherTeamId, organizationId]
      )
    ).rejects.toMatchObject({ constraint: "organizations_default_team_fk" });
    await expect(
      administration.updateOrganizationSettings(
        organizationId,
        {
          defaultTeamId: teamId
        },
        createdAt
      )
    ).resolves.toMatchObject({
      status: "updated",
      organization: { defaultTeamId: teamId }
    });

    await expect(
      administration.addOrganizationMember(
        organizationId,
        "added-member-p@example.com",
        "member"
      )
    ).resolves.toMatchObject({ status: "added" });
    await expect(
      access.findByUser(organizationId, addedMemberId)
    ).resolves.toMatchObject({
      role: "member",
      teams: [{ teamId, role: "member" }]
    });

    await pool.query(
      "INSERT INTO organization_members(organization_id,user_id,status) VALUES($1,$2,'pending')",
      [organizationId, joinerId]
    );

    await expect(
      access.findByUser(organizationId, joinerId)
    ).resolves.toBeNull();

    await expect(
      administration.updateOrganizationMember(organizationId, joinerId, {
        status: "active"
      })
    ).resolves.toMatchObject({
      status: "saved",
      member: { status: "active" }
    });
    await expect(
      access.findByUser(organizationId, joinerId)
    ).resolves.toMatchObject({
      role: "member",
      teams: [{ teamId, role: "member" }]
    });

    await expect(
      administration.updateOrganizationMember(organizationId, joinerId, {
        status: "blocked"
      })
    ).resolves.toMatchObject({ status: "saved" });
    await expect(
      access.findByUser(organizationId, joinerId)
    ).resolves.toBeNull();
    await expect(
      administration.addOrganizationMember(
        organizationId,
        "joiner-p@example.com",
        "admin"
      )
    ).resolves.toEqual({ status: "already_member" });

    await expect(
      administration.updateOrganizationMember(organizationId, ownerId, {
        status: "blocked"
      })
    ).resolves.toEqual({ status: "owner_immutable" });
    await expect(
      administration.removeOrganizationMember(organizationId, ownerId)
    ).resolves.toEqual({ status: "owner_immutable" });
    await expect(
      administration.removeOrganizationMember(organizationId, joinerId)
    ).resolves.toEqual({ status: "removed" });
    await expect(administration.deleteTeam(organizationId, teamId)).resolves.toBe(
      true
    );
    await expect(
      administration.findOrganization(organizationId)
    ).resolves.toMatchObject({ defaultTeamId: null });

    await pool.query("DELETE FROM organizations WHERE id=$1", [organizationId]);
    const remaining = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM organization_members
       WHERE organization_id = $1`,
      [organizationId]
    );
    expect(remaining.rows[0]?.total).toBe(0);
  });

  it("preserves user-scoped data when organization access is removed", async () => {
    const organizationId = "00000000-0000-0000-0000-000000000027";
    const ownerId = "10000000-0000-0000-0000-000000000027";
    const memberId = "10000000-0000-0000-0000-000000000028";
    const teamId = "20000000-0000-0000-0000-000000000027";
    const memoryId = "30000000-0000-0000-0000-000000000027";
    const documentId = "40000000-0000-0000-0000-000000000027";
    const sourceNodeId = "60000000-0000-0000-0000-000000000027";
    const targetNodeId = "60000000-0000-0000-0000-000000000028";
    const edgeId = "70000000-0000-0000-0000-000000000027";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'membership-retention', 'Membership Retention')`,
      [organizationId]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'retention-owner@example.com', 'Retention Owner'),
              ($2, 'retention-member@example.com', 'Retention Member')`,
      [ownerId, memberId]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
      [organizationId, ownerId, memberId]
    );
    await pool.query(
      `INSERT INTO teams (id, organization_id, slug, name)
       VALUES ($1, $2, 'retention-team', 'Retention Team')`,
      [teamId, organizationId]
    );
    await pool.query(
      `INSERT INTO team_members (organization_id, team_id, user_id)
       VALUES ($1, $2, $3)`,
      [organizationId, teamId, memberId]
    );
    await pool.query(
      `INSERT INTO organization_agent_tokens (
         organization_id, user_id, token_hash, masked
       ) VALUES ($1, $2, $3, 'amt_••••test')`,
      [organizationId, memberId, "e".repeat(64)]
    );
    await pool.query(
      `INSERT INTO memories (
         id, organization_id, scope_kind, user_id, kind, title, content,
         source_type, created_by
       ) VALUES ($1, $2, 'user', $3, 'fact', 'Private fact', 'Retained', 'user', $3)`,
      [memoryId, organizationId, memberId]
    );
    await pool.query(
      `INSERT INTO documents (
         id, organization_id, scope_kind, user_id, title, object_key,
         checksum, mime_type, created_by
       ) VALUES ($1, $2, 'user', $3, 'Private document', $4, $5, 'text/plain', $3)`,
      [
        documentId,
        organizationId,
        memberId,
        `organizations/${organizationId}/documents/${documentId}/source`,
        "d".repeat(64)
      ]
    );
    await pool.query(
      `INSERT INTO knowledge_nodes (
         id, organization_id, scope_kind, user_id, kind, canonical_name
       ) VALUES ($1, $3, 'user', $4, 'person', 'Retained source'),
                ($2, $3, 'user', $4, 'system', 'Retained target')`,
      [sourceNodeId, targetNodeId, organizationId, memberId]
    );
    await pool.query(
      `INSERT INTO knowledge_edges (
         id, organization_id, scope_kind, user_id, source_node_id,
         target_node_id, predicate
       ) VALUES ($1, $2, 'user', $3, $4, $5, 'uses')`,
      [edgeId, organizationId, memberId, sourceNodeId, targetNodeId]
    );

    const administration = createOrganizationAdministrationRepository(db);
    await expect(
      administration.removeOrganizationMember(organizationId, memberId)
    ).resolves.toEqual({ status: "removed" });
    const retained = await pool.query<{
      documentCount: number;
      edgeCount: number;
      memoryCount: number;
      nodeCount: number;
      status: string;
      teamCount: number;
      tokenCount: number;
    }>(
      `SELECT om.status,
              (SELECT count(*)::int FROM team_members WHERE organization_id = $1 AND user_id = $2) AS "teamCount",
              (SELECT count(*)::int FROM organization_agent_tokens WHERE organization_id = $1 AND user_id = $2) AS "tokenCount",
              (SELECT count(*)::int FROM memories WHERE organization_id = $1 AND user_id = $2) AS "memoryCount",
              (SELECT count(*)::int FROM documents WHERE organization_id = $1 AND user_id = $2) AS "documentCount",
              (SELECT count(*)::int FROM knowledge_nodes WHERE organization_id = $1 AND user_id = $2) AS "nodeCount",
              (SELECT count(*)::int FROM knowledge_edges WHERE organization_id = $1 AND user_id = $2) AS "edgeCount"
       FROM organization_members om
       WHERE om.organization_id = $1 AND om.user_id = $2`,
      [organizationId, memberId]
    );
    expect(retained.rows[0]).toEqual({
      status: "removed",
      teamCount: 0,
      tokenCount: 0,
      memoryCount: 1,
      documentCount: 1,
      nodeCount: 2,
      edgeCount: 1
    });
    await expect(
      administration.findOrganizationMember(organizationId, memberId)
    ).resolves.toBeNull();
    await expect(
      createOrganizationAccessRepository(db).findByUser(
        organizationId,
        memberId
      )
    ).resolves.toBeNull();
    await expect(
      administration.addOrganizationMember(
        organizationId,
        "retention-member@example.com",
        "member"
      )
    ).resolves.toMatchObject({ status: "added", member: { status: "active" } });
    await expect(
      pool.query(
        `SELECT count(*)::int AS total
         FROM memories
         WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, memberId]
      )
    ).resolves.toMatchObject({ rows: [{ total: 1 }] });
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

    const administration = createOrganizationAdministrationRepository(db);
    await expect(
      administration.removeOrganizationMember(organization, user)
    ).resolves.toEqual({ status: "removed" });
    await expect(repository.findById(organization, memoryId)).resolves.toMatchObject({
      id: memoryId,
      createdBy: user
    });

    const actorForeignKeys = await pool.query<{
      constraintName: string;
      referencedTable: string;
    }>(
      `SELECT tc.constraint_name AS "constraintName",
              ccu.table_name AS "referencedTable"
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.constraint_name = ANY($1::text[])
       ORDER BY tc.constraint_name`,
      [[
        "documents_created_by_users_id_fk",
        "knowledge_candidates_reviewed_by_users_id_fk",
        "knowledge_node_merges_merged_by_users_id_fk",
        "memories_created_by_users_id_fk",
        "memory_access_grants_granted_by_users_id_fk",
        "memory_versions_changed_by_users_id_fk"
      ]]
    );
    expect(actorForeignKeys.rows).toHaveLength(6);
    expect(
      actorForeignKeys.rows.every((foreignKey) => foreignKey.referencedTable === "users")
    ).toBe(true);
  });

  it("excludes expired and not-yet-valid memory from search", async () => {
    const organization = "00000000-0000-0000-0000-000000000041";
    const user = "10000000-0000-0000-0000-000000000041";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'organization-r', 'Organization R')`,
      [organization]
    );
    await pool.query(
      `INSERT INTO users (id, email, name)
       VALUES ($1, 'user-r@example.com', 'User R')`,
      [user]
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id)
       VALUES ($1, $2)`,
      [organization, user]
    );

    const repository = createMemoryRepository(db);
    const access: OrganizationAccess = {
      organizationId: organization,
      userId: user,
      role: "member",
      teams: []
    };
    const createdAt = new Date("2026-08-26T00:00:00.000Z");
    await repository.save(
      createMemory({
        id: "30000000-0000-0000-0000-000000000041",
        kind: "rule",
        scope: { kind: "organization", organizationId: organization },
        title: "Expiring freeze policy",
        content: "The deployment freeze policy expires soon.",
        source: { type: "user" },
        createdBy: user,
        validFrom: createdAt,
        expiresAt: new Date("2026-08-28T00:00:00.000Z"),
        now: createdAt
      })
    );
    await repository.save(
      createMemory({
        id: "30000000-0000-0000-0000-000000000042",
        kind: "rule",
        scope: { kind: "organization", organizationId: organization },
        title: "Upcoming freeze policy",
        content: "The next deployment freeze policy starts later.",
        source: { type: "user" },
        createdBy: user,
        validFrom: new Date("2026-09-01T00:00:00.000Z"),
        now: createdAt
      })
    );

    const insideWindow = await repository.search({
      access,
      query: "freeze policy",
      now: new Date("2026-08-27T00:00:00.000Z"),
      limit: 10
    });
    expect(insideWindow.map((hit) => hit.memory.id)).toEqual([
      "30000000-0000-0000-0000-000000000041"
    ]);

    const afterExpiry = await repository.search({
      access,
      query: "freeze policy",
      now: new Date("2026-08-29T00:00:00.000Z"),
      limit: 10
    });
    expect(afterExpiry).toEqual([]);
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
    const uploadLimits = {
      maximumOrganizationStorageBytes: 1_024,
      maximumPendingDocuments: 10,
      maximumUserUploadsPerHour: 10
    } as const;
    await expect(repository.save(document, uploadLimits)).resolves.toBe("saved");
    const quotaDocument = createDocument({
      ...document,
      id: "40000000-0000-0000-0000-000000000106",
      title: "Quota probe",
      objectKey: `organizations/${organization}/documents/quota-probe/source`,
      sizeBytes: 1,
      now: createdAt
    });
    await expect(
      repository.save(quotaDocument, {
        ...uploadLimits,
        maximumOrganizationStorageBytes: document.sizeBytes
      })
    ).resolves.toBe("organization_storage_exceeded");
    await expect(
      repository.save(quotaDocument, {
        ...uploadLimits,
        maximumPendingDocuments: 1
      })
    ).resolves.toBe("pending_documents_exceeded");
    await expect(
      repository.save(quotaDocument, {
        ...uploadLimits,
        maximumUserUploadsPerHour: 1
      })
    ).resolves.toBe("user_rate_exceeded");

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
    await expect(
      repository.claimForProcessing(
        organization,
        documentId,
        new Date(
          createdAt.getTime() + documentProcessingLeaseMilliseconds - 1
        )
      )
    ).resolves.toBeNull();
    const reclaimedAt = new Date(
      createdAt.getTime() + documentProcessingLeaseMilliseconds + 1
    );
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
    const saveCandidate = candidateRepository.save;
    await expect(saveCandidate(candidate)).resolves.toMatchObject({
      id: candidate.id,
      scope: document.scope,
      status: "pending"
    });
    await expect(
      saveCandidate({
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
    const graphRepository = createKnowledgeGraphRepository(db);
    await graphRepository.saveNode(
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
      status: "promoted",
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
    if (promotion.status !== "promoted") {
      throw new Error("knowledge candidate was not promoted");
    }
    await graphRepository.saveNode(
      createKnowledgeNode({
        id: "60000000-0000-0000-0000-000000000063",
        scope: document.scope,
        kind: "role",
        canonicalName: "Unrelated role",
        source: { chunkId: chunk.id },
        now: createdAt
      })
    );
    const replayedPromotion = await candidateRepository.accept({
      candidateId: candidate.id,
      organizationId: organization,
      entityPromotions: [],
      relationshipIds: [],
      reviewedAt: createdAt,
      reviewedBy: user
    });
    expect(replayedPromotion).toMatchObject({
      status: "promoted",
      candidate: { status: "accepted" },
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
    if (replayedPromotion.status !== "promoted") {
      throw new Error("accepted knowledge candidate was not replayed");
    }
    expect(replayedPromotion.nodes.map((node) => node.id)).toEqual(
      promotion.nodes.map((node) => node.id).toSorted()
    );
    expect(replayedPromotion.edges.map((edge) => edge.id)).toEqual(
      promotion.edges.map((edge) => edge.id).toSorted()
    );
    const otherGraphOrganization =
      "00000000-0000-0000-0000-000000000026";
    const otherGraphNode = "60000000-0000-0000-0000-000000000026";
    await pool.query(
      `INSERT INTO organizations (id, slug, name)
       VALUES ($1, 'candidate-other', 'Candidate Other')`,
      [otherGraphOrganization]
    );
    await pool.query(
      `INSERT INTO knowledge_nodes (
         id, organization_id, scope_kind, kind, canonical_name
       ) VALUES ($1, $2, 'organization', 'role', 'Cross tenant')`,
      [otherGraphNode, otherGraphOrganization]
    );
    await expect(
      pool.query(
        `INSERT INTO knowledge_candidate_nodes (
           organization_id, candidate_id, node_id
         ) VALUES ($1, $2, $3)`,
        [organization, candidate.id, otherGraphNode]
      )
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "knowledge_candidate_nodes_organization_node_fk"
    });
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
    // Re-accepting an already promoted candidate stays idempotent even after
    // its source document is archived; only new promotions require readiness.
    await expect(
      candidateRepository.accept({
        candidateId: candidate.id,
        organizationId: organization,
        entityPromotions: [],
        relationshipIds: [],
        reviewedAt: createdAt,
        reviewedBy: user
      })
    ).resolves.toMatchObject({
      status: "promoted",
      candidate: { status: "accepted" }
    });
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
    await expect(
      repository.findNodesByCanonicalNames(
        {
          organizationId: organization,
          userId: user,
          role: "member",
          teams: [{ teamId: team, role: "member" }]
        },
        scope,
        ["Ｃｈｅｃｋｏｕｔ   API"]
      )
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sourceNodeId }),
        expect.objectContaining({ id: duplicateNode.id })
      ])
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
    const applicationClock = new Date("2101-01-01T00:00:00Z");
    const clockedRepository = createKnowledgeGraphRepository(db, () => applicationClock);
    await pool.query(
      "UPDATE memories SET valid_from=$3, expires_at=$4 WHERE organization_id=$1 AND id IN ($2,$5)",
      [organization, sourceMemoryId, new Date("2100-01-01"), new Date("2102-01-01"), corroboratingMemoryId]
    );
    expect((await clockedRepository.searchNodes({ access, query: "checkout purchases", limit: 10 }))[0]?.node.id).toBe(sourceNodeId);
    expect(await clockedRepository.findNodesByCanonicalNames(access, scope, ["Checkout API"]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: sourceNodeId })]));
    expect((await clockedRepository.findNeighborhood(access, sourceNodeId, 2, 10)).edges)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: edge.id })]));
    const expiredRepository = createKnowledgeGraphRepository(db, () => new Date("2103-01-01"));
    expect(await expiredRepository.searchNodes({ access, query: "checkout purchases", limit: 10 })).toEqual([]);
    expect(await expiredRepository.findNodesByCanonicalNames(access, scope, ["Checkout API"])).toEqual([]);
    expect(await expiredRepository.findNeighborhood(access, sourceNodeId, 2, 10)).toEqual({ nodes: [], edges: [] });
    const futureRepository = createKnowledgeGraphRepository(db, () => new Date("2099-01-01"));
    expect(await futureRepository.searchNodes({ access, query: "checkout purchases", limit: 10 })).toEqual([]);
    await pool.query(
      "UPDATE memories SET valid_from=$3, expires_at=NULL WHERE organization_id=$1 AND id IN ($2,$4)",
      [organization, sourceMemoryId, createdAt, corroboratingMemoryId]
    );
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

    for (const unavailable of [
      { status: "archived", validFrom: createdAt, expiresAt: null, userId: null },
      { status: "active", validFrom: new Date("2100-01-01"), expiresAt: null, userId: null },
      { status: "active", validFrom: createdAt, expiresAt: new Date("2026-08-27"), userId: null },
      { status: "active", validFrom: createdAt, expiresAt: null, userId: otherUser }
    ]) {
      await pool.query(
        `UPDATE memories
         SET status = $3, valid_from = $4, expires_at = $5,
             scope_kind = $6, team_id = $7, user_id = $8
         WHERE organization_id = $1 AND id = $2`,
        [organization, corroboratingMemoryId, unavailable.status,
          unavailable.validFrom, unavailable.expiresAt,
          unavailable.userId ? "user" : "team",
          unavailable.userId ? null : team, unavailable.userId]
      );
      const expectedSources = [{ memoryId: sourceMemoryId }];
      const filteredHits = await repository.searchNodes({ access, query: "checkout", limit: 10 });
      expect(filteredHits.find((hit) => hit.node.id === sourceNodeId)?.node.sources)
        .toEqual(expectedSources);
      const duplicates = await repository.findNodesByCanonicalNames(access, scope, ["Checkout API"]);
      expect(duplicates.find((node) => node.id === sourceNodeId)?.sources)
        .toEqual(expectedSources);
      const neighborhood = await repository.findNeighborhood(access, sourceNodeId, 2, 10);
      expect(neighborhood.nodes.find((node) => node.id === sourceNodeId)?.sources)
        .toEqual(expectedSources);
      expect(neighborhood.edges.find((record) => record.id === edge.id)?.sources)
        .toEqual(expectedSources);
      expect((await repository.findNodeById(organization, sourceNodeId))?.sources)
        .toHaveLength(2);
    }

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
  it("atomically deduplicates memory and document resources with their ingestion receipts", async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const now = new Date("2026-09-09T00:00:00Z");
    await pool.query("INSERT INTO users (id, email, name) VALUES ($1, $2, 'Ingestion User')", [userId, `${userId}@example.test`]);
    await seedOrganization(createOrganization({ id: organizationId, slug: `ingestion-${organizationId}`, name: "Ingestion", now }), userId);
    const access: OrganizationAccess = { organizationId, userId, role: "owner", teams: [] };
    const scope = { kind: "user" as const, organizationId, userId };
    const receipts = createIngestionReceiptRepository(db);
    const memoryRepository = createMemoryRepository(db);
    const create = buildCreateMemory({ clock: () => now, generateId: randomUUID, repository: memoryRepository,
      receipts, fingerprint: ingestionFingerprint });
    const input = { access, scope, idempotencyKey: "memory-event", kind: "fact" as const,
      title: "A fact", content: "Grounded content", source: { type: "agent" as const } };
    const memories = await Promise.all(Array.from({ length: 8 }, () => create(input)));
    expect(new Set(memories.map((memory) => memory.id)).size).toBe(1);
    await expect(create({ ...input, content: "Different content" })).rejects.toThrow("different payload");
    expect((await receipts.find({ organizationId, userId, operation: "memory.create", key: "memory-event" }))?.resourceId).toBe(memories[0]?.id);

    const objects = new Map<string, Uint8Array>();
    const upload = buildUploadDocument({ clock: () => now, generateId: randomUUID,
      checksum: (bytes) => createHash("sha256").update(bytes).digest("hex"), receipts, fingerprint: ingestionFingerprint,
      objectStorage: { put: async (key, bytes) => { objects.set(key, bytes); },
        get: async (key) => { const bytes = objects.get(key); if (!bytes) throw new Error("missing"); return bytes; },
        delete: async (key) => { objects.delete(key); } },
      repository: createDocumentRepository(db), queue: { enqueue: async () => "queued" },
      limits: { maximumOrganizationStorageBytes: 1000, maximumPendingDocuments: 1, maximumUserUploadsPerHour: 1 } });
    const documentInput = { access, scope, idempotencyKey: "document-event", title: "Transcript",
      mimeType: "text/markdown", content: new TextEncoder().encode("Transcript text") };
    const documents = await Promise.all(Array.from({ length: 8 }, () => upload(documentInput)));
    expect(new Set(documents.map((document) => document.id)).size).toBe(1);
    expect(objects.size).toBe(1);
    await expect(upload({ ...documentInput, title: "Other title" })).rejects.toThrow("different payload");
    expect((await receipts.find({ organizationId, userId, operation: "document.upload", key: "document-event" }))?.resourceId).toBe(documents[0]?.id);
    const documentRepository = createDocumentRepository(db);
    const documentId = documents[0]!.id;
    await documentRepository.markEnqueueFailure(organizationId, documentId, "test failure", now);
    const queued: number[] = [];
    const retry = buildRetryDocument({ repository: documentRepository, receipts, fingerprint: ingestionFingerprint,
      clock: () => now, queue: { enqueue: async (_organization, _document, expectedAttempts) => {
        queued.push(expectedAttempts!); return "queued";
      } } });
    await retry(access, documentId, { idempotencyKey: "retry-0", expectedAttempts: 0 });
    await retry(access, documentId, { idempotencyKey: "retry-0", expectedAttempts: 0 });
    expect(queued).toEqual([0, 0]);
    const first = await documentRepository.claimForProcessing(organizationId, documentId, now, 0);
    expect(first).not.toBeNull();
    await documentRepository.failProcessing(first!, "test processing failure", now);
    expect(await documentRepository.claimForProcessing(organizationId, documentId, now, 0)).toBeNull();
    await retry(access, documentId, { idempotencyKey: "retry-0", expectedAttempts: 0 });
    expect(queued).toEqual([0, 0]);
    await retry(access, documentId, { idempotencyKey: "retry-1", expectedAttempts: 1 });
    const second = await documentRepository.claimForProcessing(organizationId, documentId, now, 1);
    const recovered = await documentRepository.claimForProcessing(organizationId, documentId,
      new Date(now.getTime() + documentProcessingLeaseMilliseconds + 1), 1);
    expect(second?.document.processingAttempts).toBe(2);
    expect(recovered?.document.processingAttempts).toBe(2);
    expect(recovered?.leaseId).not.toBe(second?.leaseId);
    await expect(retry(access, documentId, { idempotencyKey: "retry-1", expectedAttempts: 2 })).rejects.toThrow("different payload");
    const failedId = randomUUID();
    await expect(memoryRepository.save({ ...memories[0]!, id: failedId, scope: { kind: "team", organizationId, teamId: randomUUID() } }, {
      organizationId, userId, operation: "memory.create", key: "rollback", payloadHash: "a".repeat(64), resourceId: failedId, createdAt: now
    })).rejects.toThrow();
    expect(await receipts.find({ organizationId, userId, operation: "memory.create", key: "rollback" })).toBeNull();
  });

  it("partially reviews facts atomically while preserving pending items and excluding empty extractions", async () => {
    const organization = randomUUID();
    const user = randomUUID();
    const documentId = randomUUID();
    const chunkId = randomUUID();
    const emptyChunkId = randomUUID();
    await pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'Review test')", [organization, organization]);
    await pool.query("INSERT INTO users (id, email, name) VALUES ($1, $2, 'Reviewer')", [user, `${user}@example.test`]);
    await pool.query("INSERT INTO organization_members (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')", [organization, user]);
    await pool.query(`INSERT INTO documents (id, organization_id, scope_kind, title, object_key, checksum, mime_type, created_by, status)
      VALUES ($1, $2, 'organization', 'Review source', 'review-source', 'checksum', 'text/plain', $3, 'ready')`, [documentId, organization, user]);
    await pool.query(`INSERT INTO document_chunks (id, organization_id, document_id, ordinal, content)
      VALUES ($1, $2, $3, 0, 'A learns from B. B knows C.'), ($4, $2, $3, 1, 'Contents')`, [chunkId, organization, documentId, emptyChunkId]);
    const repository = createKnowledgeCandidateRepository(db);
    const now = new Date();
    const candidate = createKnowledgeCandidate({
      id: randomUUID(), scope: { kind: "organization", organizationId: organization }, documentId, chunkId,
      model: "test", now, graph: {
        entities: ["a", "b", "c"].map((key) => ({ key, kind: "person", canonicalName: key })),
        relationships: [{ sourceKey: "a", targetKey: "b", predicate: "student_of" }, { sourceKey: "b", targetKey: "c", predicate: "associated_with" }]
      }
    });
    await repository.save(candidate);
    await repository.save(createKnowledgeCandidate({ ...candidate, id: randomUUID(), chunkId: emptyChunkId, graph: { entities: [], relationships: [] }, now }));
    const access: OrganizationAccess = { organizationId: organization, userId: user, role: "owner", teams: [] };
    expect(await repository.listPending(access, 100)).toHaveLength(1);
    expect(await repository.listReviewSources(access)).toHaveLength(1);
    expect(await repository.listReviewSources({ ...access, organizationId: organizationB })).toEqual([]);
    expect(await repository.listReviewSources({ ...access, role: "member" })).toEqual([]);
    const input = {
      candidateId: candidate.id, organizationId: organization, reviewedBy: user, reviewedAt: now,
      selection: { entityKeys: [], relationshipIndexes: [0] },
      entityPromotions: ["a", "b"].map((key) => ({ key, id: randomUUID() })),
      relationshipIds: [randomUUID(), randomUUID()]
    };
    const results = await Promise.all([repository.accept(input), repository.accept(input)]);
    expect(results.every((result) => result.status === "promoted" && result.candidate.status === "pending")).toBe(true);
    const saved = await repository.findById(organization, candidate.id);
    expect(saved?.itemReviews).toHaveLength(3);
    expect(saved?.graph).toEqual(candidate.graph);
    const counts = await pool.query("SELECT (SELECT count(*) FROM knowledge_nodes WHERE organization_id=$1)::int nodes, (SELECT count(*) FROM knowledge_edges WHERE organization_id=$1)::int edges", [organization]);
    expect(counts.rows[0]).toEqual({ nodes: 2, edges: 1 });
    await expect(repository.reject({ candidateId: candidate.id, organizationId: organization, reviewedBy: user, reviewedAt: now,
      selection: { entityKeys: [], relationshipIndexes: [0] } })).rejects.toThrow("opposite");
    await repository.reject({ candidateId: candidate.id, organizationId: organization, reviewedBy: user, reviewedAt: now,
      selection: { entityKeys: ["c"], relationshipIndexes: [] } });
    const finished = await repository.findById(organization, candidate.id);
    expect(finished?.status).toBe("accepted");
    expect(finished?.itemReviews).toHaveLength(5);
    expect(await repository.listReviewSources(access)).toEqual([]);

    const automaticChunkId = randomUUID();
    await pool.query("INSERT INTO document_chunks (id, organization_id, document_id, ordinal, content) VALUES ($1,$2,$3,2,'A learns from B. B knows C.')", [automaticChunkId, organization, documentId]);
    const automaticCandidate = createKnowledgeCandidate({ ...candidate, id: randomUUID(), chunkId: automaticChunkId, now });
    await repository.save(automaticCandidate);
    const verify = vi.fn().mockResolvedValue({ model: "independent-verifier", items: ["entity:a", "entity:b", "entity:c", "relationship:0", "relationship:1"].map((item) => ({
      item, support: "explicit", usefulness: item === "entity:c" ? "incidental" : "useful", conflict: false, evidence: "A learns from B.", reason: "Synthetic source judgement"
    })) });
    const ontology = createKnowledgeOntologyReader(db);
    const curate = buildCurateKnowledgeCandidate({
      candidates: repository, documents: createDocumentRepository(db), access: createOrganizationAccessRepository(db),
      graph: createKnowledgeGraphRepository(db), ontology, verification: { verify }, clock: () => now,
      accept: buildAcceptKnowledgeCandidate({ clock: () => now, generateId: randomUUID, method: "automatic", repository, ontologyReader: ontology }),
      reject: buildRejectKnowledgeCandidate({ clock: () => now, method: "automatic", repository })
    });
    await curate(organization, automaticChunkId);
    await curate(organization, automaticChunkId);
    expect(verify).toHaveBeenCalledTimes(1);
    const automatic = await repository.findById(organization, automaticCandidate.id);
    expect(automatic?.status).toBe("accepted");
    expect(automatic?.assessment?.policyVersion).toBe("evidence-v1");
    expect(automatic?.itemReviews).toHaveLength(5);
    expect(automatic?.itemReviews?.every((review) => review.method === "automatic")).toBe(true);
    expect(await repository.reviewSummary(access)).toEqual({ automaticAccepted: 3, automaticIgnored: 2 });
    const afterAutomatic = await pool.query("SELECT (SELECT count(*) FROM knowledge_nodes WHERE organization_id=$1)::int nodes, (SELECT count(*) FROM knowledge_edges WHERE organization_id=$1)::int edges", [organization]);
    expect(afterAutomatic.rows[0]).toEqual({ nodes: 2, edges: 1 });
    expect(await repository.reviewSummary({ ...access, organizationId: organizationB })).toEqual({ automaticAccepted: 0, automaticIgnored: 0 });
  });

});
