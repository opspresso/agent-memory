import { describe, expect, it, vi } from "vitest";

import {
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
import type {
  KnowledgeOntologyReader,
  OrganizationKnowledgeOntology
} from "@/domain/knowledge/knowledge-ontology-reader";

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

function ontologyReader(
  result: OrganizationKnowledgeOntology | null = null
): KnowledgeOntologyReader {
  return { findByOrganization: vi.fn().mockResolvedValue(result) };
}

function candidateRepository(): KnowledgeCandidateRepository {
  return {
    findById: vi.fn(),
    findByChunkId: vi.fn(),
    listReviewSources: vi.fn(),
    saveAssessment: vi.fn(),
    reviewSummary: vi.fn(),
    processingProgress: vi.fn(),
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
    archive: vi.fn(),
    search: vi.fn()
  };
}

describe("knowledge candidate", () => {
  it("normalizes compatible extracted kinds", () => {
    expect(
      createKnowledgeCandidate({
        id: "candidate-1",
        scope,
        documentId: "document-1",
        chunkId: "chunk-1",
        model: "model",
        graph: {
          entities: [
            {
              key: "hero",
              kind: "designation",
              canonicalName: " AWS  AI Hero "
            }
          ],
          relationships: []
        },
        now
      })
    ).toMatchObject({
      graph: {
        entities: [
          { kind: "recognition", canonicalName: "AWS AI Hero" }
        ]
      }
    });
  });

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
      ontologyReader: ontologyReader(),
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
      documentTitle: document.title,
      mimeType: document.mimeType,
      quotaKey: {
        organizationId: "organization-1",
        userId: document.createdBy
      }
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
      ontologyReader: ontologyReader(),
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
      ontologyReader: ontologyReader(),
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

  it("passes the organization ontology hint to extraction when enabled", async () => {
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
    const extract = vi.fn().mockResolvedValue({ model: "model", graph: graph() });
    const generate = buildGenerateKnowledgeCandidate({
      candidateRepository: candidateRepository(),
      clock: () => now,
      documentRepository: documentRepository(
        vi.fn().mockResolvedValue({ document, chunk })
      ),
      extractionService: { extract },
      generateId: () => "candidate-1",
      ontologyReader: ontologyReader({
        mode: "warn",
        ontology: { nodeKinds: ["service"], edgePredicates: ["stores_in"] }
      })
    });

    await generate("organization-1", "chunk-1");

    expect(extract).toHaveBeenCalledWith({
      content: chunk.content,
      documentTitle: document.title,
      mimeType: document.mimeType,
      quotaKey: {
        organizationId: "organization-1",
        userId: document.createdBy
      },
      ontology: {
        mode: "warn",
        nodeKinds: ["service"],
        edgePredicates: ["stores_in"]
      }
    });
  });

  it("omits the ontology hint when validation is off or the dictionary is empty", async () => {
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
      content: "content",
      now
    });
    const extract = vi.fn().mockResolvedValue({ model: "model", graph: graph() });
    const generate = buildGenerateKnowledgeCandidate({
      candidateRepository: candidateRepository(),
      clock: () => now,
      documentRepository: documentRepository(
        vi.fn().mockResolvedValue({ document, chunk })
      ),
      extractionService: { extract },
      generateId: () => "candidate-1",
      ontologyReader: ontologyReader({
        mode: "strict",
        ontology: { nodeKinds: [], edgePredicates: [] }
      })
    });

    await generate("organization-1", "chunk-1");

    expect(extract).toHaveBeenCalledWith({
      content: chunk.content,
      documentTitle: document.title,
      mimeType: document.mimeType,
      quotaKey: {
        organizationId: "organization-1",
        userId: document.createdBy
      }
    });
  });

});
