import { describe, expect, it, vi } from "vitest";

import { buildIngestDocument } from "@/application/document/ingest-document";
import { createDocumentChunk } from "@/domain/document/document";
import type { DocumentKnowledgeEnrichmentQueue } from "@/domain/document/document-services";

describe("document ingestion orchestration", () => {
  it("replays chunk scheduling after a partial enqueue failure", async () => {
    const chunks = ["chunk-1", "chunk-2"].map((id, ordinal) => createDocumentChunk({
      id, ordinal, organizationId: "organization-1", documentId: "document-1",
      content: "Document content", now: new Date("2026-08-26")
    }));
    const processDocument = vi.fn().mockResolvedValue(undefined);
    const listChunksByDocument = vi.fn().mockResolvedValue(chunks);
    const failure = new Error("queue unavailable");
    const enqueueKnowledgeEnrichment = vi.fn<DocumentKnowledgeEnrichmentQueue["enqueueKnowledgeEnrichment"]>()
      .mockResolvedValueOnce("queued")
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce("already_queued")
      .mockResolvedValueOnce("queued");
    const ingest = buildIngestDocument({
      processDocument,
      repository: { listChunksByDocument },
      enrichmentQueue: { enqueueKnowledgeEnrichment }
    });

    await expect(ingest("organization-1", "document-1")).rejects.toBe(failure);
    await expect(ingest("organization-1", "document-1")).resolves.toBeUndefined();
    expect(listChunksByDocument).toHaveBeenCalledWith("organization-1", "document-1");
    expect(enqueueKnowledgeEnrichment.mock.calls).toEqual([
      ["organization-1", "chunk-1"], ["organization-1", "chunk-2"],
      ["organization-1", "chunk-1"], ["organization-1", "chunk-2"]
    ]);
  });

  it("does not schedule enrichment when processing fails", async () => {
    const failure = new Error("processing failed");
    const listChunksByDocument = vi.fn();
    const enqueueKnowledgeEnrichment = vi.fn();
    const ingest = buildIngestDocument({
      processDocument: vi.fn().mockRejectedValue(failure),
      repository: { listChunksByDocument },
      enrichmentQueue: { enqueueKnowledgeEnrichment }
    });

    await expect(ingest("organization-1", "document-1")).rejects.toBe(failure);
    expect(listChunksByDocument).not.toHaveBeenCalled();
    expect(enqueueKnowledgeEnrichment).not.toHaveBeenCalled();
  });

  it("skips chunk lookup when enrichment is disabled", async () => {
    const processDocument = vi.fn().mockResolvedValue(undefined);
    const listChunksByDocument = vi.fn();
    const ingest = buildIngestDocument({ processDocument, repository: { listChunksByDocument } });

    await ingest("organization-1", "document-1");
    expect(processDocument).toHaveBeenCalledWith("organization-1", "document-1");
    expect(listChunksByDocument).not.toHaveBeenCalled();
  });
});
