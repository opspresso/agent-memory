import { describe, expect, it, vi } from "vitest";

import {
  buildGenerateDocumentKnowledgeCandidates,
  buildGenerateKnowledgeCandidate,
  KnowledgeCandidateSourceNotFoundError
} from "@/application/knowledge/generate-knowledge-candidate";
import { createDocument, createDocumentChunk } from "@/domain/document/document";
import type { DocumentRepository } from "@/domain/document/document-repository";
import {
  createKnowledgeCandidate,
  InvalidKnowledgeCandidateError
} from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";

const now = new Date("2026-08-26T00:00:00.000Z");
const scope = {
  kind: "team" as const,
  organizationId: "organization-1",
  teamId: "team-1"
};

function graph() {
  return {
    entities: [
      { key: "api", kind: "service", canonicalName: "Memory API" },
      { key: "db", kind: "database", canonicalName: "Memory Database" }
    ],
    relationships: [
      { sourceKey: "api", targetKey: "db", predicate: "stores_in" }
    ]
  };
}

function candidateRepository(): KnowledgeCandidateRepository {
  return {
    findById: vi.fn(),
    findByChunkId: vi.fn(),
    listPending: vi.fn(),
    save: vi.fn((value) => value),
    accept: vi.fn(),
    reject: vi.fn()
  };
}

function documentRepository(
  findChunkById: DocumentRepository["findChunkById"]
): DocumentRepository {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    findChunkById,
    listChunksByDocument: vi.fn(),
    claimForProcessing: vi.fn(),
    completeProcessing: vi.fn(),
    failProcessing: vi.fn(),
    markEnqueueFailure: vi.fn(),
    search: vi.fn()
  };
}

describe("knowledge candidate", () => {
  it("normalizes a bounded graph while preserving source scope and provenance", () => {
    const candidate = createKnowledgeCandidate({
      id: "candidate-1",
      scope,
      documentId: "document-1",
      chunkId: "chunk-1",
      model: " extraction-model ",
      graph: {
        entities: [
          { key: "api", kind: " Service ", canonicalName: "Memory API" },
          { key: "db", kind: "Database", canonicalName: "Memory Database" }
        ],
        relationships: [
          { sourceKey: "api", targetKey: "db", predicate: " STORES_IN " }
        ]
      },
      now
    });

    expect(candidate).toMatchObject({
      scope,
      documentId: "document-1",
      chunkId: "chunk-1",
      model: "extraction-model",
      status: "pending",
      graph: {
        entities: [{ kind: "service" }, { kind: "database" }],
        relationships: [{ predicate: "stores_in" }]
      }
    });
  });

  it("rejects relationships that do not reference extracted entities", () => {
    expect(() =>
      createKnowledgeCandidate({
        id: "candidate-1",
        scope,
        documentId: "document-1",
        chunkId: "chunk-1",
        model: "model",
        graph: {
          entities: [{ key: "api", kind: "service", canonicalName: "API" }],
          relationships: [
            { sourceKey: "api", targetKey: "missing", predicate: "calls" }
          ]
        },
        now
      })
    ).toThrow(InvalidKnowledgeCandidateError);
  });

  it("extracts a candidate only from a ready, tenant-scoped chunk", async () => {
    const document = {
      ...createDocument({
        id: "document-1",
        scope,
        title: "Architecture",
        objectKey: "document-1/source",
        checksum: "a".repeat(64),
        mimeType: "text/plain",
        sizeBytes: 10,
        createdBy: "user-1",
        now
      }),
      status: "ready" as const
    };
    const chunk = createDocumentChunk({
      id: "chunk-1",
      organizationId: "organization-1",
      documentId: "document-1",
      ordinal: 0,
      content: "Memory API stores data in Memory Database.",
      now
    });
    const candidates = candidateRepository();
    const extract = vi.fn().mockResolvedValue({ model: "model", graph: graph() });
    const generate = buildGenerateKnowledgeCandidate({
      candidateRepository: candidates,
      clock: () => now,
      documentRepository: documentRepository(
        vi.fn().mockResolvedValue({ document, chunk })
      ),
      extractionService: { extract },
      generateId: () => "candidate-1"
    });

    await expect(generate("organization-1", "chunk-1")).resolves.toMatchObject({
      chunkId: "chunk-1",
      status: "pending",
      scope
    });
    expect(extract).toHaveBeenCalledWith({
      content: chunk.content,
      documentTitle: document.title
    });
    expect(candidates.save).toHaveBeenCalledOnce();
  });

  it("returns an existing candidate without repeating AI extraction", async () => {
    const existing = createKnowledgeCandidate({
      id: "candidate-1",
      scope,
      documentId: "document-1",
      chunkId: "chunk-1",
      model: "model",
      graph: graph(),
      now
    });
    const candidates = candidateRepository();
    vi.mocked(candidates.findByChunkId).mockResolvedValue(existing);
    const extractionService = { extract: vi.fn() };
    const generate = buildGenerateKnowledgeCandidate({
      candidateRepository: candidates,
      clock: () => now,
      documentRepository: documentRepository(vi.fn()),
      extractionService,
      generateId: () => "candidate-2"
    });

    await expect(generate("organization-1", "chunk-1")).resolves.toBe(existing);
    expect(extractionService.extract).not.toHaveBeenCalled();
    expect(candidates.save).not.toHaveBeenCalled();
  });

  it("does not extract from a chunk whose document is not ready", async () => {
    const document = createDocument({
      id: "document-1",
      scope,
      title: "Pending",
      objectKey: "document-1/source",
      checksum: "a".repeat(64),
      mimeType: "text/plain",
      sizeBytes: 10,
      createdBy: "user-1",
      now
    });
    const chunk = createDocumentChunk({
      id: "chunk-1",
      organizationId: "organization-1",
      documentId: "document-1",
      ordinal: 0,
      content: "pending",
      now
    });
    const generate = buildGenerateKnowledgeCandidate({
      candidateRepository: candidateRepository(),
      clock: () => now,
      documentRepository: documentRepository(
        vi.fn().mockResolvedValue({ document, chunk })
      ),
      extractionService: { extract: vi.fn() },
      generateId: () => "candidate-1"
    });

    await expect(generate("organization-1", "chunk-1")).rejects.toBeInstanceOf(
      KnowledgeCandidateSourceNotFoundError
    );
  });

  it("enriches every ready document chunk and remains idempotent per chunk", async () => {
    const document = {
      ...createDocument({
        id: "document-1",
        scope,
        title: "Architecture",
        objectKey: "document-1/source",
        checksum: "a".repeat(64),
        mimeType: "text/plain",
        sizeBytes: 10,
        createdBy: "user-1",
        now
      }),
      status: "ready" as const
    };
    const chunks = [0, 1].map((ordinal) =>
      createDocumentChunk({
        id: `chunk-${ordinal + 1}`,
        organizationId: "organization-1",
        documentId: "document-1",
        ordinal,
        content: `chunk ${ordinal + 1}`,
        now
      })
    );
    const documents = documentRepository(
      vi.fn(async (_organizationId, chunkId) => ({
        document,
        chunk: chunks.find((chunk) => chunk.id === chunkId)!
      }))
    );
    vi.mocked(documents.findById).mockResolvedValue(document);
    vi.mocked(documents.listChunksByDocument).mockResolvedValue(chunks);
    const candidates = candidateRepository();
    const extract = vi.fn().mockResolvedValue({ model: "model", graph: graph() });
    const enrich = buildGenerateDocumentKnowledgeCandidates({
      candidateRepository: candidates,
      clock: () => now,
      documentRepository: documents,
      extractionService: { extract },
      generateId: vi
        .fn()
        .mockReturnValueOnce("candidate-1")
        .mockReturnValueOnce("candidate-2")
    });

    await expect(enrich("organization-1", "document-1")).resolves.toHaveLength(
      2
    );
    expect(extract).toHaveBeenCalledTimes(2);
    expect(candidates.save).toHaveBeenCalledTimes(2);
  });
});
