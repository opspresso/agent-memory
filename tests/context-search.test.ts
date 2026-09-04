import { describe, expect, it, vi } from "vitest";

import {
  buildSearchContext,
  type ContextSearchDependencies
} from "@/application/context/search-context";
import {
  createDocument,
  createDocumentChunk
} from "@/domain/document/document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { createMemory } from "@/domain/memory/memory";
import { TextRerankerUnavailableError } from "@/domain/shared/text-reranker-service";
import { publicContextSearchResult } from "@/lib/context-http";

const now = new Date("2026-08-26T00:00:00.000Z");
const organizationId = "00000000-0000-0000-0000-000000000001";
const userId = "10000000-0000-0000-0000-000000000001";
const access: OrganizationAccess = {
  organizationId,
  userId,
  role: "member",
  teams: []
};
const scope = { kind: "user", organizationId, userId } as const;
const memory = createMemory({
  id: "30000000-0000-0000-0000-000000000001",
  kind: "decision",
  scope,
  title: "Rollback decision",
  content: "Use the previous release.",
  source: { type: "user" },
  createdBy: userId,
  validFrom: now,
  now
});
const document = createDocument({
  id: "40000000-0000-0000-0000-000000000001",
  scope,
  title: "Runbook",
  objectKey: "runbook",
  checksum: "a".repeat(64),
  mimeType: "text/plain",
  sizeBytes: 10,
  createdBy: userId,
  now
});
const chunk = createDocumentChunk({
  id: "50000000-0000-0000-0000-000000000001",
  organizationId,
  documentId: document.id,
  ordinal: 0,
  content: "Rollback runbook",
  now
});
const node = createKnowledgeNode({
  id: "60000000-0000-0000-0000-000000000001",
  scope,
  kind: "system",
  canonicalName: "Release service",
  source: { memoryId: memory.id },
  now
});

function dependencies(
  overrides: Partial<ContextSearchDependencies> = {}
): ContextSearchDependencies {
  return {
    searchMemories: vi.fn().mockResolvedValue([]),
    searchDocuments: vi.fn().mockResolvedValue([]),
    searchKnowledge: vi.fn().mockResolvedValue([]),
    ...overrides
  };
}

describe("unified context search", () => {
  it("searches all context stores with the same authorized scope", async () => {
    const configured = dependencies();
    const search = buildSearchContext(configured);

    await expect(search(access, "rollback", 5)).resolves.toEqual({
      hits: [],
      counts: { memories: 0, documents: 0, knowledge: 0 },
      ranking: "hybrid"
    });
    expect(configured.searchMemories).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      undefined
    );
    expect(configured.searchDocuments).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      undefined
    );
    expect(configured.searchKnowledge).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      undefined
    );
  });

  it("shares one query embedding across every context store", async () => {
    const embedding = { model: "embedding-model", values: [1, 0] };
    const embed = vi.fn().mockResolvedValue(embedding);
    const configured = dependencies({
      embeddingService: { embed, embedMany: vi.fn() }
    });
    const search = buildSearchContext(configured);

    await search(access, " rollback ", 5);

    expect(embed).toHaveBeenCalledOnce();
    expect(embed).toHaveBeenCalledWith("rollback");
    expect(configured.searchMemories).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      embedding
    );
    expect(configured.searchDocuments).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      embedding
    );
    expect(configured.searchKnowledge).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      embedding
    );
  });

  it("reranks balanced authorized candidates across every context store", async () => {
    const rerank = vi.fn().mockResolvedValue([0.2, 0.9, 0.5]);
    const configured = dependencies({
      searchMemories: vi.fn().mockResolvedValue([
        { memory, lexicalScore: 0.9, vectorScore: 0, score: 0.9 }
      ]),
      searchDocuments: vi.fn().mockResolvedValue([
        { document, chunk, lexicalScore: 0.8, vectorScore: 0, score: 0.8 }
      ]),
      searchKnowledge: vi.fn().mockResolvedValue([
        { node, lexicalScore: 0.7, vectorScore: 0, score: 0.7 }
      ]),
      rerankerService: { rerank }
    });
    const search = buildSearchContext(configured);

    const result = await search(access, "rollback", 2);

    expect(configured.searchMemories).toHaveBeenCalledWith(
      access,
      "rollback",
      4,
      undefined
    );
    expect(result.hits.map((hit) => hit.sourceType)).toEqual([
      "document",
      "knowledge"
    ]);
    expect(result.hits[0]).toMatchObject({
      candidateScore: 0.8,
      rerankScore: 0.9,
      score: 0.9
    });
    expect(result.ranking).toBe("rerank");
    expect(rerank).toHaveBeenCalledWith({
      query: "rollback",
      documents: [
        "Memory decision\nTitle: Rollback decision\nUse the previous release.",
        "Document: Runbook\nChunk 1\nRollback runbook",
        "Knowledge system\nName: Release service"
      ]
    });
  });

  it("bounds the query and candidate text sent to the reranker", async () => {
    const longMemory = createMemory({
      ...memory,
      content: "한".repeat(20_000),
      now
    });
    const rerank = vi.fn().mockResolvedValue([0.5]);
    const search = buildSearchContext(
      dependencies({
        searchMemories: vi.fn().mockResolvedValue([
          { memory: longMemory, lexicalScore: 1, vectorScore: 0, score: 1 }
        ]),
        rerankerService: { rerank }
      })
    );

    await search(access, "질".repeat(5_000), 1);

    const input = rerank.mock.calls[0]?.[0];
    expect([...input.query]).toHaveLength(4_000);
    expect([...input.documents[0]]).toHaveLength(8_000);
  });

  it("falls back to hybrid ranking when the reranker is unavailable", async () => {
    const onRerankerUnavailable = vi.fn();
    const search = buildSearchContext(
      dependencies({
        searchMemories: vi.fn().mockResolvedValue([
          { memory, lexicalScore: 0.7, vectorScore: 0, score: 0.7 }
        ]),
        searchDocuments: vi.fn().mockResolvedValue([
          { document, chunk, lexicalScore: 0.9, vectorScore: 0, score: 0.9 }
        ]),
        rerankerService: {
          rerank: vi
            .fn()
            .mockRejectedValue(
              new TextRerankerUnavailableError("provider unavailable")
            )
        },
        onRerankerUnavailable
      })
    );

    const result = await search(access, "rollback", 2);

    expect(result.hits.map((hit) => hit.sourceType)).toEqual([
      "document",
      "memory"
    ]);
    expect(result.ranking).toBe("hybrid");
    expect(onRerankerUnavailable).toHaveBeenCalledOnce();
  });

  it("applies the configured rerank relevance floor", async () => {
    const search = buildSearchContext(
      dependencies({
        searchMemories: vi.fn().mockResolvedValue([
          { memory, lexicalScore: 0.9, vectorScore: 0, score: 0.9 }
        ]),
        searchDocuments: vi.fn().mockResolvedValue([
          { document, chunk, lexicalScore: 0.8, vectorScore: 0, score: 0.8 }
        ]),
        rerankerService: {
          rerank: vi.fn().mockResolvedValue([0.1, 0.8])
        },
        minimumRerankScore: 0.5
      })
    );

    const result = await search(access, "rollback", 2);

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.sourceType).toBe("document");
  });

  it("projects ranked hits without changing access-dependent fields", async () => {
    const search = buildSearchContext(
      dependencies({
        searchMemories: vi.fn().mockResolvedValue([
          { memory, lexicalScore: 0.7, vectorScore: 0, score: 0.7 }
        ])
      })
    );

    const projected = publicContextSearchResult(
      await search(access, "rollback", 1),
      access
    );

    expect(projected).toMatchObject({
      count: 1,
      counts: { memories: 1, documents: 0, knowledge: 0 },
      ranking: "hybrid",
      hits: [
        {
          sourceType: "memory",
          candidateScore: 0.7,
          score: 0.7,
          memory: { capabilities: { write: true, manage: true } }
        }
      ]
    });
  });
});
