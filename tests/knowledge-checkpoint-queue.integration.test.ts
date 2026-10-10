import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "@/infrastructure/database/client";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { createKnowledgeExtractionCheckpointRepository } from "@/infrastructure/database/repositories/knowledge-extraction-checkpoint-repository";
import { createPgBossDocumentIngestionQueue, documentKnowledgeEnrichmentQueueName as queueName, type DocumentKnowledgeEnrichmentJob } from "@/infrastructure/queue/document-ingestion-queue";
import { createEntityFirstKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-entity-first-extraction-service";
import { createAiRequestLimiter } from "@/infrastructure/ai/request-limiter";
import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";
import { buildGenerateKnowledgeCandidate } from "@/application/knowledge/generate-knowledge-candidate";
import { createKnowledgeCandidateRepository } from "@/infrastructure/database/repositories/knowledge-candidate-repository";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { createKnowledgeOntologyReader } from "@/infrastructure/database/repositories/knowledge-ontology-reader";
import { safeErrorForBoundary } from "@/infrastructure/observability/error-details";

describe("checkpointed knowledge jobs", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let queue: ReturnType<typeof createPgBossDocumentIngestionQueue>;
  const queueErrors: Error[] = [];
  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").start();
    database = createDatabase(container.getConnectionUri());
    await initializeSchema(database.pool);
    queue = createPgBossDocumentIngestionQueue(container.getConnectionUri(), (error) => queueErrors.push(error));
    await queue.start();
  });
  beforeEach(async () => { await (await queue.start()).deleteAllJobs(queueName); });
  afterEach(() => { expect(queueErrors.splice(0)).toEqual([]); });
  afterAll(async () => { await queue?.stop(); await database?.close(); await container?.stop(); });

  async function fixture() {
    const organizationId = randomUUID(), userId = randomUUID(), documentId = randomUUID(), chunkId = randomUUID();
    await database.pool.query("INSERT INTO organizations(id,slug,name) VALUES($1,$2,'Checkpoint test')", [organizationId, organizationId]);
    await database.pool.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Owner')", [userId, `${userId}@example.test`]);
    await database.pool.query("INSERT INTO organization_members(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')", [organizationId, userId]);
    await database.pool.query("INSERT INTO documents(id,organization_id,scope_kind,title,object_key,checksum,mime_type,status,created_by) VALUES($1,$2,'organization','Source','fixture','fixture','text/plain','ready',$3)", [documentId, organizationId, userId]);
    await database.pool.query("INSERT INTO document_chunks(id,organization_id,document_id,ordinal,content) VALUES($1,$2,$3,0,'Atlas 서비스는 Orion 서비스를 사용한다.')", [chunkId, organizationId, documentId]);
    return { organizationId, userId, chunkId, documentId };
  }
  async function nextJob() {
    const [job] = await (await queue.start()).fetch<DocumentKnowledgeEnrichmentJob>(queueName, { includeMetadata: true });
    if (!job) throw new Error("expected queued job");
    return job;
  }
  async function makeDue(id: string) {
    // Move only this disposable job's schedule instead of sleeping through quota windows.
    await database.pool.query("UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE name=$1 AND id=$2", [queueName, id]);
  }
  async function continuation(chunkId: string) {
    const result = await database.pool.query("SELECT id FROM pgboss.job WHERE name=$1 AND singleton_key=$2 AND state='created'", [queueName, chunkId]);
    expect(result.rows).toHaveLength(1);
    return (await queue.start()).getJobById<DocumentKnowledgeEnrichmentJob>(queueName, result.rows[0].id);
  }

  it("isolates checkpoints by organization and preserves the first concurrent result", async () => {
    const f = await fixture(), other = await fixture();
    const checkpoints = createKnowledgeExtractionCheckpointRepository(database.db);
    const key = { organizationId: f.organizationId, chunkId: f.chunkId, fingerprint: "a".repeat(64), model: "model" };
    const saved = await Promise.all(["Atlas", "Orion"].map((canonicalName) => checkpoints.save({ ...key, entities: [{ key: "e0", kind: "service", canonicalName }] })));
    expect(saved[0]?.entities).toEqual(saved[1]?.entities);
    expect((await createKnowledgeExtractionCheckpointRepository(database.db).find(key))?.entities).toEqual(saved[0]?.entities);
    expect(await checkpoints.find({ ...key, organizationId: other.organizationId })).toBeNull();
    await expect(checkpoints.save({ ...key, organizationId: other.organizationId, entities: [] })).rejects.toMatchObject({ cause: { code: "23503" } });
  });

  it("resumes after a quota deferral without repeating entity extraction or publishing a partial graph", async () => {
    const f = await fixture(), boss = await queue.start();
    let now = 0;
    const limiter = createAiRequestLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 1, clock: () => now });
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const phase = JSON.parse(options!.body as string).response_format.json_schema.name;
      return Response.json({ choices: [{ message: { content: JSON.stringify(phase === "knowledge_entities"
        ? { entities: ["Atlas", "Orion"].map((canonicalName) => ({ canonicalName, kind: "service", aliases: [], summary: null, evidenceIds: ["s0"] })) }
        : { relationships: [{ sourceKey: "e0", targetKey: "e1", predicate: "uses", evidenceIds: ["s0"] }] }) } }] });
    });
    const candidates = createKnowledgeCandidateRepository(database.db);
    const build = () => buildGenerateKnowledgeCandidate({ candidateRepository: candidates,
      accessRepository: createOrganizationAccessRepository(database.db), documentRepository: createDocumentRepository(database.db),
      ontologyReader: createKnowledgeOntologyReader(database.db), clock: () => new Date(), generateId: randomUUID,
      extractionService: createEntityFirstKnowledgeExtractionService({ model: "test", baseUrl: "http://model.test/v1", request, requestLimiter: limiter,
        checkpoints: createKnowledgeExtractionCheckpointRepository(database.db) }) });
    await queue.enqueueKnowledgeEnrichment(f.organizationId, f.chunkId, { userId: f.userId, action: "manage" }, 20);
    const claim = await nextJob();
    await expect(build()(f.organizationId, f.chunkId, { userId: f.userId, action: "manage" })).rejects.toBeInstanceOf(AiRequestLimitExceededError);
    expect(await candidates.findByChunkId(f.organizationId, f.chunkId)).toBeNull();
    expect(await queue.deferKnowledgeEnrichment(claim, 60)).toBe("deferred");
    expect(await boss.getJobById(queueName, claim.id)).toMatchObject({ state: "completed", output: { deferred: true }, retryCount: 0 });
    const next = await continuation(f.chunkId);
    expect(next).toMatchObject({ state: "created", priority: 20, retryCount: 0, retryLimit: 5, data: { principal: { userId: f.userId, action: "manage" } } });
    expect(next!.startAfter.getTime()).toBeGreaterThan(Date.now() + 55_000);
    expect(await boss.fetch(queueName)).toEqual([]);
    now = 60_000;
    await makeDue(next!.id);
    const resumed = await nextJob();
    const candidate = await build()(f.organizationId, f.chunkId, resumed.data.principal);
    expect(candidate?.graph.relationships).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    await boss.complete(queueName, resumed.id);
  });

  it.each([true, false])("preserves consumed failure retries and rejects a stale worker claim, backoff=%s", async (retryBackoff) => {
    const f = await fixture(), boss = await queue.start();
    await boss.send(queueName, { organizationId: f.organizationId, chunkId: f.chunkId, principal: { userId: f.userId, action: "write" } },
      { singletonKey: f.chunkId, retryLimit: 3, retryDelay: 1, retryBackoff });
    const old = await nextJob();
    await boss.fail(queueName, old.id);
    await makeDue(old.id);
    const current = await nextJob();
    expect(current.retryCount).toBe(1);
    expect(await queue.deferKnowledgeEnrichment(old, 1)).toBe("lost_claim");
    expect((await boss.getJobById(queueName, current.id))?.state).toBe("active");
    expect(await queue.deferKnowledgeEnrichment(current, 60)).toBe("deferred");
    const next = await continuation(f.chunkId);
    expect(next).toMatchObject({ retryLimit: 2, retryCount: 0, retryDelay: retryBackoff ? 2 : 1, retryBackoff });
  });

  it("rolls back completion if scheduling the continuation fails", async () => {
    const f = await fixture(), boss = await queue.start();
    await queue.enqueueKnowledgeEnrichment(f.organizationId, f.chunkId, { userId: f.userId, action: "write" });
    const claim = await nextJob();
    const error = new Error("schedule unavailable");
    vi.spyOn(boss, "send").mockRejectedValueOnce(error);
    await expect(queue.deferKnowledgeEnrichment(claim, 60)).rejects.toBe(error);
    expect((await boss.getJobById(queueName, claim.id))?.state).toBe("active");
  });

  it("can defer beyond the failure retry limit without exhausting it", async () => {
    const f = await fixture();
    await queue.enqueueKnowledgeEnrichment(f.organizationId, f.chunkId, { userId: f.userId, action: "write" });
    for (let index = 0; index < 7; index++) {
      const claim = await nextJob();
      expect(claim.retryCount).toBe(0);
      expect(claim.retryLimit).toBe(5);
      expect(await queue.deferKnowledgeEnrichment(claim, 60)).toBe("deferred");
      const next = await continuation(f.chunkId);
      await makeDue(next!.id);
    }
  });

  it("keeps the native worker acknowledgement from swallowing a deferred continuation", async () => {
    const f = await fixture(), boss = await queue.start();
    let attempts = 0;
    await boss.work<DocumentKnowledgeEnrichmentJob, unknown, { includeMetadata: true; pollingIntervalSeconds: number }>(queueName,
      { includeMetadata: true, pollingIntervalSeconds: .5 }, async ([job]) => {
        if (!job) return;
        attempts += 1;
        if (attempts === 1) await queue.deferKnowledgeEnrichment(job, 1);
      });
    try {
      await queue.enqueueKnowledgeEnrichment(f.organizationId, f.chunkId, { userId: f.userId, action: "write" });
      await expect.poll(async () => {
        const rows = await database.pool.query("SELECT state,output FROM pgboss.job WHERE name=$1 AND singleton_key=$2", [queueName, f.chunkId]);
        return rows.rows.length === 2 && rows.rows.every((row) => row.state === "completed");
      }, { timeout: 8_000, interval: 100 }).toBe(true);
      expect(attempts).toBe(2);
    } finally { await boss.offWork(queueName); }
  });

  it("stores a failed job without private provider or SQL error payloads", async () => {
    const f = await fixture(), boss = await queue.start();
    const privateValue = "private-source-sentinel";
    await boss.work(queueName, { pollingIntervalSeconds: .5 }, async () => {
      throw safeErrorForBoundary(Object.assign(new Error(`params: ${privateValue}`, {
        cause: Object.assign(new Error(privateValue), { code: "23503" })
      }), { params: [privateValue] }), "knowledge job failed");
    });
    try {
      const id = await boss.send(queueName, { organizationId: f.organizationId, chunkId: f.chunkId, principal: { userId: f.userId, action: "write" } }, { retryLimit: 0 });
      await expect.poll(async () => (await boss.getJobById(queueName, id!))?.state, { timeout: 5_000, interval: 100 }).toBe("failed");
      const job = await boss.getJobById(queueName, id!);
      expect(JSON.stringify(job?.output)).not.toContain(privateValue);
      expect(job?.output).toMatchObject({ message: "knowledge job failed", details: { cause: { code: "23503" } } });
    } finally { await boss.offWork(queueName); }
  });
});
