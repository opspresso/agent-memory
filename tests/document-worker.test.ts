import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  candidateFindByChunkId: vi.fn(),
  documentClaim: vi.fn(),
  documentFindChunk: vi.fn(),
  documentListChunks: vi.fn(),
  enqueueKnowledgeEnrichment: vi.fn(),
  knowledgeExtractionService: undefined as
    | undefined
    | { extract: ReturnType<typeof vi.fn> },
  loggerInfo: vi.fn(),
  queueStart: vi.fn(),
  queueStop: vi.fn(),
  work: vi.fn()
}));

vi.mock("@/infrastructure/observability/logger", () => ({
  logger: { info: mocks.loggerInfo }
}));

vi.mock("@/lib/container", () => ({
  documentIngestionQueue: {
    enqueueKnowledgeEnrichment: mocks.enqueueKnowledgeEnrichment,
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
  documentTextExtractor: {},
  textEmbeddingService: undefined
}));

describe("document worker startup", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loggerInfo.mockReset();
    mocks.candidateFindByChunkId.mockReset();
    mocks.documentClaim.mockReset();
    mocks.documentFindChunk.mockReset();
    mocks.documentListChunks.mockReset();
    mocks.enqueueKnowledgeEnrichment.mockReset();
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
          documentId: "40000000-0000-4000-8000-000000000001"
        }
      }
    ]);
    expect(mocks.enqueueKnowledgeEnrichment.mock.calls).toEqual([
      [
        "00000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000001"
      ],
      [
        "00000000-0000-4000-8000-000000000001",
        "50000000-0000-4000-8000-000000000002"
      ]
    ]);

    await enrichmentHandler([
      {
        data: {
          organizationId: "00000000-0000-4000-8000-000000000001",
          chunkId: "50000000-0000-4000-8000-000000000001"
        }
      }
    ]);
    expect(mocks.candidateFindByChunkId).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      "50000000-0000-4000-8000-000000000001"
    );
    expect(mocks.documentFindChunk).not.toHaveBeenCalled();
  });
});
