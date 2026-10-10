import { beforeEach, describe, expect, it, vi } from "vitest";

const requester = "00000000-0000-4000-8000-000000000001";
const writePrincipal = { userId: requester, action: "write" as const };

const mocks = vi.hoisted(() => ({
  curate: vi.fn(),
  findAccess: vi.fn(),
  candidateFindByChunkId: vi.fn(),
  documentClaim: vi.fn(),
  documentFindChunk: vi.fn(),
  documentListChunks: vi.fn(),
  enqueueKnowledgeEnrichment: vi.fn(),
  deferKnowledgeEnrichment: vi.fn(),
  deferIngestion: vi.fn(),
  knowledgeExtractionService: undefined as
    | undefined
    | { extract: ReturnType<typeof vi.fn> },
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  queueStart: vi.fn(),
  queueStop: vi.fn(),
  work: vi.fn()
}));

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { info: mocks.loggerInfo, error: mocks.loggerError }
}));

vi.mock("@/lib/knowledge-curation-service", () => ({ curateKnowledgeCandidate: mocks.curate }));

vi.mock("@/lib/container", () => ({
  organizationAccessRepository: { findByUser: mocks.findAccess },
  documentIngestionQueue: {
    enqueueKnowledgeEnrichment: mocks.enqueueKnowledgeEnrichment,
    deferKnowledgeEnrichment: mocks.deferKnowledgeEnrichment,
    deferIngestion: mocks.deferIngestion,
    start: mocks.queueStart,
    stop: mocks.queueStop
  },
  knowledgeCandidateRepository: {
    findByChunkId: mocks.candidateFindByChunkId
  },
  get knowledgeExtractionService() {
    return mocks.knowledgeExtractionService;
  },
  knowledgeOntologyReader: {},
  documentObjectStorage: {},
  documentRepository: {
    claimForProcessing: mocks.documentClaim,
    findChunkById: mocks.documentFindChunk,
    listChunksByDocument: mocks.documentListChunks
  },
  documentProcessingCheckpointRepository: undefined,
  documentEmbeddingCheckpoints: undefined,
  documentTextExtractor: {},
  textEmbeddingService: undefined
}));

describe("document worker startup", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loggerInfo.mockReset();
    mocks.loggerError.mockReset();
    mocks.curate.mockReset();
    mocks.findAccess.mockReset();
    mocks.candidateFindByChunkId.mockReset();
    mocks.documentClaim.mockReset();
    mocks.documentFindChunk.mockReset();
    mocks.documentListChunks.mockReset();
    mocks.enqueueKnowledgeEnrichment.mockReset();
    mocks.deferIngestion.mockReset().mockResolvedValue("deferred");
    mocks.deferKnowledgeEnrichment.mockReset().mockResolvedValue("deferred");
    mocks.knowledgeExtractionService = undefined;
    mocks.queueStart.mockReset();
    mocks.queueStop.mockReset();
    mocks.work.mockReset();
    mocks.queueStart.mockResolvedValue({ work: mocks.work });
  });

  it("cleans up a failed registration and allows a retry", async () => {
    const registrationFailure = new Error("worker registration failed");
    mocks.work
      .mockRejectedValueOnce(registrationFailure)
      .mockResolvedValueOnce("worker-1");
    const { startDocumentWorker } = await import("@/lib/document-worker");

    await expect(startDocumentWorker()).rejects.toBe(registrationFailure);
    expect(mocks.queueStop).toHaveBeenCalledOnce();

    await expect(startDocumentWorker()).resolves.toBeUndefined();
    expect(mocks.queueStart).toHaveBeenCalledTimes(2);
    expect(mocks.work).toHaveBeenCalledTimes(2);
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      "document ingestion worker started"
    );
  });

  it("preserves registration and queue cleanup failures together", async () => {
    const registrationFailure = new Error("worker registration failed");
    const cleanupFailure = new Error("queue cleanup failed");
    mocks.work.mockRejectedValue(registrationFailure);
    mocks.queueStop.mockRejectedValue(cleanupFailure);
    const { startDocumentWorker } = await import("@/lib/document-worker");

    await expect(startDocumentWorker()).rejects.toMatchObject({
      message: "document worker startup and queue cleanup both failed",
      errors: [registrationFailure, cleanupFailure]
    });
  });

  it("enqueues and processes one independent job per document chunk", async () => {
    mocks.knowledgeExtractionService = { extract: vi.fn() };
    mocks.work
      .mockResolvedValueOnce("ingestion-worker")
      .mockResolvedValueOnce("enrichment-worker");
    mocks.documentClaim.mockResolvedValue(null);
    mocks.documentListChunks.mockResolvedValue([
      { id: "50000000-0000-4000-8000-000000000001" },
      { id: "50000000-0000-4000-8000-000000000002" }
    ]);
    mocks.candidateFindByChunkId.mockResolvedValue({ id: "candidate-1" });
    const { startDocumentWorker } = await import("@/lib/document-worker");

    await startDocumentWorker();

    const ingestionHandler = mocks.work.mock.calls[0]?.[2];
    const enrichmentHandler = mocks.work.mock.calls[1]?.[2];
    if (
      typeof ingestionHandler !== "function" ||
      typeof enrichmentHandler !== "function"
    ) {
      throw new Error("document workers were not registered");
    }
    await ingestionHandler([
      {
        data: {
          organizationId: "00000000-0000-4000-8000-000000000001",
          documentId: "40000000-0000-4000-8000-000000000001",
          generation: "40000000-0000-4000-8000-000000000001",
          requestedBy: requester
        }
      }
    ]);
    expect(mocks.enqueueKnowledgeEnrichment.mock.calls).toEqual([
      [
        "00000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000001",
        writePrincipal
      ],
      [
        "00000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000002",
        writePrincipal
      ]
    ]);

    await enrichmentHandler([
      {
        data: {
          organizationId: "00000000-0000-4000-8000-000000000001",
          chunkId: "50000000-0000-4000-8000-000000000001",
          principal: writePrincipal
        }
      }
    ]);
    expect(mocks.candidateFindByChunkId).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "50000000-0000-4000-8000-000000000001"
    );
    expect(mocks.documentFindChunk).not.toHaveBeenCalled();
    expect(mocks.curate).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000001", requester);
  });

  it("checks the explicit queue requester before attempting new extraction", async () => {
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const requestedBy = "00000000-0000-4000-8000-000000000002";
    mocks.knowledgeExtractionService = { extract: vi.fn() };
    mocks.documentFindChunk.mockResolvedValue({ document: {
      status: "ready", createdBy: "original-uploader", scope: { organizationId, kind: "organization" }
    } });
    mocks.findAccess.mockResolvedValue(null);
    const { startDocumentWorker } = await import("@/lib/document-worker");
    await startDocumentWorker();
    await mocks.work.mock.calls[1]![2]([{ data: {
      organizationId, principal: { userId: requestedBy, action: "manage" }, chunkId: "50000000-0000-4000-8000-000000000001"
    } }]);
    expect(mocks.findAccess).toHaveBeenCalledExactlyOnceWith(organizationId, requestedBy);
    expect(mocks.knowledgeExtractionService.extract).not.toHaveBeenCalled();
  });

  it.each([true, false])("defers quota backpressure only, quota=%s", async (quota) => {
    const { AiRequestLimitExceededError } = await import("@/domain/shared/ai-request-limiter");
    mocks.knowledgeExtractionService = { extract: vi.fn() };
    mocks.candidateFindByChunkId.mockResolvedValue({ id: "candidate" });
    const error = quota ? new AiRequestLimitExceededError(42) : new Error("provider failed");
    mocks.curate.mockRejectedValue(error);
    const { startDocumentWorker } = await import("@/lib/document-worker");
    await startDocumentWorker();
    expect(mocks.work.mock.calls[1]![1]).toMatchObject({ includeMetadata: true });
    const job = { id: "job", retryCount: 2, startedOn: new Date(), data: {
      organizationId: "00000000-0000-4000-8000-000000000001", chunkId: "50000000-0000-4000-8000-000000000001", principal: writePrincipal
    } };
    const run = mocks.work.mock.calls[1]![2]([job]);
    if (quota) {
      await expect(run).resolves.toBeUndefined();
      expect(mocks.deferKnowledgeEnrichment).toHaveBeenCalledExactlyOnceWith(job, 42);
      expect(mocks.loggerError).not.toHaveBeenCalled();
    } else {
      await expect(run).rejects.toMatchObject({ message: "document knowledge enrichment job failed", details: { type: "Error" } });
      expect(mocks.deferKnowledgeEnrichment).not.toHaveBeenCalled();
    }
  });

  it.each([true, false])("defers document ingestion quota without hiding provider failures, quota=%s", async (quota) => {
    const { AiRequestLimitExceededError } = await import("@/domain/shared/ai-request-limiter");
    mocks.documentClaim.mockRejectedValue(quota ? new AiRequestLimitExceededError(30) : new Error("provider failed"));
    const { startDocumentWorker } = await import("@/lib/document-worker");
    await startDocumentWorker();
    expect(mocks.work.mock.calls[0]![1]).toMatchObject({ includeMetadata: true });
    const job = { id: "job", retryCount: 1, startedOn: new Date(), data: {
      organizationId: requester, requestedBy: requester,
      documentId: "40000000-0000-4000-8000-000000000001", generation: "40000000-0000-4000-8000-000000000001"
    } };
    const run = mocks.work.mock.calls[0]![2]([job]);
    if (quota) {
      await expect(run).resolves.toBeUndefined();
      expect(mocks.deferIngestion).toHaveBeenCalledExactlyOnceWith(job, 30);
      expect(mocks.loggerError).not.toHaveBeenCalled();
    } else {
      await expect(run).rejects.toMatchObject({ message: "document ingestion job failed" });
      expect(mocks.deferIngestion).not.toHaveBeenCalled();
    }
  });

  it("does not hand source-bearing errors to pg-boss failure storage", async () => {
    mocks.knowledgeExtractionService = { extract: vi.fn() };
    mocks.candidateFindByChunkId.mockResolvedValue({ id: "candidate" });
    const privateValue = "private-source-sentinel";
    mocks.curate.mockRejectedValue(Object.assign(new Error(`Failed query params: ${privateValue}`, {
      cause: Object.assign(new Error(privateValue), { code: "23503", detail: privateValue })
    }), { params: [privateValue] }));
    const { startDocumentWorker } = await import("@/lib/document-worker");
    await startDocumentWorker();
    const result = await mocks.work.mock.calls[1]![2]([{ data: {
      organizationId: "00000000-0000-4000-8000-000000000001", chunkId: "50000000-0000-4000-8000-000000000001", principal: writePrincipal
    } }]).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
    expect(JSON.stringify({ ...result, message: result.message, stack: result.stack })).not.toContain(privateValue);
    expect(result.details).toMatchObject({ cause: { code: "23503" } });
    expect(mocks.loggerError).toHaveBeenCalledOnce();
  });
});
