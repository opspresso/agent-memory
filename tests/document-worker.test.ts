import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
    enqueueKnowledgeEnrichment: vi.fn(),
    start: mocks.queueStart,
    stop: mocks.queueStop
  },
  knowledgeCandidateRepository: {},
  knowledgeExtractionService: undefined,
  documentObjectStorage: {},
  documentRepository: {},
  documentTextExtractor: {},
  textEmbeddingService: undefined
}));

describe("document worker startup", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loggerInfo.mockReset();
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
});
