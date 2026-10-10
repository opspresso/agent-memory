import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildProcessDocument } from "@/application/document/process-document";
import { createDocument, createDocumentChunk } from "@/domain/document/document";
import { documentProcessingLeaseMilliseconds } from "@/domain/document/document-services";
import { AiRequestLimitExceededError } from "@/domain/shared/ai-request-limiter";
import { createDatabase } from "@/infrastructure/database/client";
import { initializeSchema } from "@/infrastructure/database/schema-bootstrap.mjs";
import { createDocumentRepository } from "@/infrastructure/database/repositories/document-repository";
import { createDocumentProcessingCheckpointRepository } from "@/infrastructure/database/repositories/document-processing-checkpoint-repository";
import { createDocumentEmbeddingCheckpointRepository } from "@/infrastructure/database/repositories/document-embedding-checkpoint-repository";
import { createOrganizationAccessRepository } from "@/infrastructure/database/repositories/organization-access-repository";
import { users, organizations, organizationMembers } from "@/infrastructure/database/schema";
import { createAiRequestLimiter } from "@/infrastructure/ai/request-limiter";
import { createTextEmbeddingService } from "@/infrastructure/ai/text-embedding-service";
import { createPgBossDocumentIngestionQueue, documentIngestionQueueName, type DocumentIngestionJob } from "@/infrastructure/queue/document-ingestion-queue";
import { embeddingBatchFingerprint } from "@/lib/embedding-configuration";

describe("checkpointed document ingestion", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabase>;
  let queue: ReturnType<typeof createPgBossDocumentIngestionQueue>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("pgvector/pgvector:0.8.6-pg18-trixie").start();
    database = createDatabase(container.getConnectionUri());
    await initializeSchema(database.pool);
    queue = createPgBossDocumentIngestionQueue(container.getConnectionUri(), () => {});
  });
  afterAll(async () => { await queue?.stop(); await database?.close(); await container?.stop(); });

  async function fixture() {
    const organizationId = randomUUID(), userId = randomUUID(), now = new Date();
    await database.db.insert(users).values({ id: userId, email: `${userId}@example.test`, name: "Checkpoint test" });
    await database.db.insert(organizations).values({ id: organizationId, slug: organizationId, name: "Checkpoint test" });
    await database.db.insert(organizationMembers).values({ organizationId, userId, role: "owner", status: "active" });
    const repository = createDocumentRepository(database.db);
    const document = createDocument({ id: randomUUID(), scope: { organizationId, kind: "organization" }, title: "Orion",
      objectKey: "source", checksum: "a".repeat(64), mimeType: "text/plain", sizeBytes: 10, createdBy: userId, now });
    await repository.save(document);
    return { organizationId, userId, document, repository, now,
      processing: createDocumentProcessingCheckpointRepository(database.db), embeddings: createDocumentEmbeddingCheckpointRepository(database.db) };
  }

  async function checkpointCounts(documentId: string) {
    const result = await database.pool.query(`SELECT
      (SELECT count(*)::int FROM document_processing_checkpoints WHERE document_id=$1) AS processing,
      (SELECT count(*)::int FROM document_embedding_checkpoints WHERE document_id=$1) AS embeddings`, [documentId]);
    return result.rows[0];
  }
  const snapshot = { mimeType: "text/plain" as const, parts: [{ content: "Orion is a service.", start: 0, end: 19 }] };
  const fingerprint = "a".repeat(64);
  const vectors = [{ model: "test", values: [1, 0] }];

  it("finishes 512 chunks across seven quota deferrals without exhausting three failure retries", async () => {
    const f = await fixture(), boss = await queue.start();
    let time = 0;
    const content = Array.from({ length: 512 }, (_, index) => `${String(index).padStart(3, "0")} ${"x".repeat(1996)}`).join("\n");
    const extract = vi.fn(async () => ({ text: content, mimeType: "text/plain" as const }));
    const get = vi.fn(async () => new TextEncoder().encode(content));
    const batches: number[] = [], deferrals: unknown[] = [];
    const configuration = { model: "test", baseUrl: "http://model.test/v1", dimensions: 2 };
    const limiter = createAiRequestLimiter({ maxConcurrent: 1, maxRequestsPerMinute: 1, clock: () => time });
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      const input = (JSON.parse(options!.body as string) as { input: string[] }).input;
      batches.push(input.length);
      return Response.json({ data: input.map((_, index) => ({ index, embedding: [1, 0] })) });
    });
    await boss.work<DocumentIngestionJob, unknown, { includeMetadata: true; pollingIntervalSeconds: number }>(documentIngestionQueueName,
      { includeMetadata: true, pollingIntervalSeconds: .5 }, async ([job]) => {
        if (!job) return;
        // A fresh use case and adapters per delivery exercise restart recovery.
        const process = buildProcessDocument({ clock: () => new Date(f.now.getTime() + time), generateId: randomUUID,
          repository: createDocumentRepository(database.db), accessRepository: createOrganizationAccessRepository(database.db),
          objectStorage: { get, put: vi.fn(), delete: vi.fn() }, textExtractor: { extract },
          processingCheckpoints: createDocumentProcessingCheckpointRepository(database.db),
          embeddingCheckpoints: { repository: createDocumentEmbeddingCheckpointRepository(database.db), fingerprint: embeddingBatchFingerprint(configuration) },
          embeddingService: createTextEmbeddingService({ ...configuration, request, requestLimiter: limiter }) });
        try {
          await process(job.data.organizationId, job.data.documentId, job.data.generation, job.data.requestedBy);
        } catch (error) {
          if (!(error instanceof AiRequestLimitExceededError)) throw error;
          const status = (await f.repository.findById(f.organizationId, f.document.id))?.status;
          const chunks = await f.repository.listChunksByDocument(f.organizationId, f.document.id);
          await queue.deferIngestion(job, error.retryAfterSeconds);
          const next = (await boss.findJobs<DocumentIngestionJob>(documentIngestionQueueName, { data: { documentId: f.document.id } }))
            .find((candidate) => candidate.state === "created");
          if (!next) throw new Error("ingestion continuation was not created");
          deferrals.push({ status, chunkCount: chunks.length, retryCount: next.retryCount, retryLimit: next.retryLimit, data: next.data });
          time += 60_000;
          await database.pool.query("UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=$1", [next.id]);
        }
      });
    try {
      await queue.enqueue(f.organizationId, f.document.id, f.document.processingGeneration, f.userId);
      await expect.poll(async () => {
        const document = await f.repository.findById(f.organizationId, f.document.id);
        const jobs = await boss.findJobs(documentIngestionQueueName, { data: { documentId: f.document.id } });
        return document?.status === "ready" && jobs.length === 8 && jobs.every((job) => job.state === "completed");
      }, { timeout: 15_000, interval: 100 }).toBe(true);
      expect(get).toHaveBeenCalledOnce();
      expect(extract).toHaveBeenCalledOnce();
      expect(batches).toEqual(Array.from({ length: 8 }, () => 64));
      expect(deferrals).toEqual(Array.from({ length: 7 }, () => ({ status: "pending", chunkCount: 0, retryCount: 0, retryLimit: 3,
        data: { organizationId: f.organizationId, documentId: f.document.id, generation: f.document.processingGeneration, requestedBy: f.userId } })));
      expect(await f.repository.listChunksByDocument(f.organizationId, f.document.id)).toHaveLength(512);
      expect(await checkpointCounts(f.document.id)).toEqual({ processing: 0, embeddings: 0 });
    } finally { await boss.offWork(documentIngestionQueueName); }
  });

  it("reuses completed batches after a real queue failure retry while preserving the failed provider call", async () => {
    const f = await fixture(), boss = await queue.start();
    const content = Array.from({ length: 65 }, (_, index) => `${String(index).padStart(3, "0")} ${"x".repeat(1996)}`).join("\n");
    const extract = vi.fn(async () => ({ text: content, mimeType: "text/plain" as const }));
    let calls = 0;
    const embedMany = vi.fn(async (texts: readonly string[]) => {
      calls += 1;
      if (calls === 2) throw new Error("synthetic provider failure");
      return texts.map(() => ({ model: "test", values: [1, 0] }));
    });
    const build = () => buildProcessDocument({ repository: f.repository, clock: () => new Date(), generateId: randomUUID,
      accessRepository: createOrganizationAccessRepository(database.db), textExtractor: { extract },
      objectStorage: { get: async () => new TextEncoder().encode(content), put: vi.fn(), delete: vi.fn() },
      processingCheckpoints: createDocumentProcessingCheckpointRepository(database.db),
      embeddingCheckpoints: { repository: createDocumentEmbeddingCheckpointRepository(database.db),
        fingerprint: embeddingBatchFingerprint({ model: "test", baseUrl: "http://model.test/v1" }) },
      embeddingService: { embed: vi.fn(), embedMany } });
    await queue.enqueue(f.organizationId, f.document.id, f.document.processingGeneration, f.userId);
    const [first] = await boss.fetch<DocumentIngestionJob>(documentIngestionQueueName, { includeMetadata: true });
    await expect(build()(f.organizationId, f.document.id, first!.data.generation, first!.data.requestedBy)).rejects.toThrow("synthetic provider failure");
    expect((await f.repository.findById(f.organizationId, f.document.id))?.status).toBe("failed");
    expect(await checkpointCounts(f.document.id)).toEqual({ processing: 1, embeddings: 1 });
    await boss.fail(documentIngestionQueueName, first!.id);
    await database.pool.query("UPDATE pgboss.job SET start_after=now()-interval '1 second' WHERE id=$1", [first!.id]);
    const [retry] = await boss.fetch<DocumentIngestionJob>(documentIngestionQueueName, { includeMetadata: true });
    expect(retry?.retryCount).toBe(1);
    expect(retry?.data.generation).toBe(first!.data.generation);
    await build()(f.organizationId, f.document.id, retry!.data.generation, retry!.data.requestedBy);
    await boss.complete(documentIngestionQueueName, retry!.id);
    expect(extract).toHaveBeenCalledOnce();
    expect(embedMany.mock.calls.map(([texts]) => texts.length)).toEqual([64, 1, 1]);
    expect((await f.repository.findById(f.organizationId, f.document.id))?.status).toBe("ready");
    expect(await checkpointCounts(f.document.id)).toEqual({ processing: 0, embeddings: 0 });
  });

  it("retains completed work for a replacement lease while refusing writes by the stale worker or another tenant", async () => {
    const f = await fixture(), other = await fixture();
    const claim = (await f.repository.claimForProcessing(f.organizationId, f.document.id, f.now, f.document.processingGeneration))!;
    await f.processing.save(claim, snapshot);
    await f.embeddings.save({ claim, fingerprint }, vectors);
    await f.embeddings.save({ claim, fingerprint }, [{ model: "test", values: [0, 1] }]);
    const later = new Date(f.now.getTime() + documentProcessingLeaseMilliseconds + 1);
    const replacement = (await f.repository.claimForProcessing(f.organizationId, f.document.id, later, f.document.processingGeneration))!;
    expect(await f.processing.find(claim)).toBeNull();
    expect(await f.embeddings.find({ claim, fingerprint })).toBeNull();
    await expect(f.processing.save(claim, snapshot)).rejects.toThrow("claim was lost");
    await expect(f.embeddings.save({ claim, fingerprint }, vectors)).rejects.toThrow("claim was lost");
    expect(await f.processing.find(replacement)).toEqual(snapshot);
    expect(await f.embeddings.find({ claim: replacement, fingerprint })).toEqual(vectors);
    expect(await f.embeddings.find({ claim: replacement, fingerprint: "b".repeat(64) })).toBeNull();
    const foreign = { ...replacement, document: { ...replacement.document, scope: other.document.scope } };
    expect(await f.processing.find(foreign)).toBeNull();
    expect(await f.embeddings.find({ claim: foreign, fingerprint })).toBeNull();
    await expect(f.embeddings.save({ claim: foreign, fingerprint }, vectors)).rejects.toThrow("claim was lost");
    await expect(database.pool.query(`INSERT INTO document_processing_checkpoints (organization_id,document_id,generation,mime_type,parts)
      VALUES ($1,$2,$3,'text/plain',$4)`, [other.organizationId, f.document.id, f.document.processingGeneration, JSON.stringify(snapshot.parts)]))
      .rejects.toMatchObject({ code: "23503" });
  });

  it.each(["complete", "retry", "archive"])("cleans only the document's temporary checkpoints on %s", async (transition) => {
    const f = await fixture(), other = await fixture();
    const claim = (await f.repository.claimForProcessing(f.organizationId, f.document.id, f.now, f.document.processingGeneration))!;
    const otherClaim = (await other.repository.claimForProcessing(other.organizationId, other.document.id, other.now, other.document.processingGeneration))!;
    for (const current of [claim, otherClaim]) {
      await f.processing.save(current, snapshot);
      await f.embeddings.save({ claim: current, fingerprint }, vectors);
    }
    if (transition === "complete") await f.repository.completeProcessing(claim, [createDocumentChunk({ id: randomUUID(),
      organizationId: f.organizationId, documentId: f.document.id, ordinal: 0, content: snapshot.parts[0]!.content, now: f.now })], f.now);
    else if (transition === "archive") await f.repository.archive(f.organizationId, f.document.id, f.now, f.document.scope);
    else {
      await f.repository.failProcessing(claim, "temporary failure", f.now);
      await f.repository.prepareRetry((await f.repository.findById(f.organizationId, f.document.id))!, 1, f.now);
    }
    expect(await checkpointCounts(f.document.id)).toEqual({ processing: 0, embeddings: 0 });
    expect(await checkpointCounts(other.document.id)).toEqual({ processing: 1, embeddings: 1 });
    await expect(f.processing.save(claim, snapshot)).rejects.toThrow("claim was lost");
    await expect(f.embeddings.save({ claim, fingerprint }, vectors)).rejects.toThrow("claim was lost");
    expect(await f.repository.findById(f.organizationId, f.document.id)).not.toBeNull();
  });

  it("rejects corrupted checkpoints without including source text or embedding values in errors", async () => {
    const f = await fixture();
    const claim = (await f.repository.claimForProcessing(f.organizationId, f.document.id, f.now, f.document.processingGeneration))!;
    const sentinel = "private-checkpoint-sentinel";
    const invalidParts = f.processing.save(claim, { mimeType: "text/plain", parts: [{ content: sentinel, start: 10, end: 1 }] });
    await expect(invalidParts).rejects.toThrow("document processing checkpoint is invalid");
    await database.pool.query(`INSERT INTO document_embedding_checkpoints (organization_id,document_id,generation,fingerprint,embeddings)
      VALUES ($1,$2,$3,$4,$5)`, [f.organizationId, f.document.id, f.document.processingGeneration, fingerprint,
      JSON.stringify([{ model: "test", values: [sentinel] }])]);
    const error = await f.embeddings.find({ claim, fingerprint }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: "document embedding checkpoint is invalid" });
    expect(String(error)).not.toContain(sentinel);
    expect(error).not.toHaveProperty("cause");
  });
});
