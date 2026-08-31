import { describe, expect, it, vi } from "vitest";

import { buildSearchContext } from "@/application/context/search-context";
import {
  createDocument,
  createDocumentChunk
} from "@/domain/document/document";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { createMemory } from "@/domain/memory/memory";
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

describe("unified context search", () => {
  it("searches all context stores with the same authorized scope", async () => {
    const searchMemories = vi.fn().mockResolvedValue([]);
    const searchDocuments = vi.fn().mockResolvedValue([]);
    const searchKnowledge = vi.fn().mockResolvedValue([]);
    const search = buildSearchContext({
      searchMemories,
      searchDocuments,
      searchKnowledge
    });

    await expect(search(access, "rollback", 5)).resolves.toEqual({
      memories: [],
      documents: [],
      knowledge: []
    });
    expect(searchMemories).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      undefined
    );
    expect(searchDocuments).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      undefined
    );
    expect(searchKnowledge).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      undefined
    );
  });

  it("shares one query embedding across every context store", async () => {
    const embedding = { model: "embedding-model", values: [1, 0] };
    const embed = vi.fn().mockResolvedValue(embedding);
    const searchMemories = vi.fn().mockResolvedValue([]);
    const searchDocuments = vi.fn().mockResolvedValue([]);
    const searchKnowledge = vi.fn().mockResolvedValue([]);
    const search = buildSearchContext({
      embeddingService: { embed, embedMany: vi.fn() },
      searchMemories,
      searchDocuments,
      searchKnowledge
    });

    await search(access, " rollback ", 5);

    expect(embed).toHaveBeenCalledOnce();
    expect(embed).toHaveBeenCalledWith("rollback");
    expect(searchMemories).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      embedding
    );
    expect(searchDocuments).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      embedding
    );
    expect(searchKnowledge).toHaveBeenCalledWith(
      access,
      "rollback",
      5,
      embedding
    );
  });

  it("merges heterogeneous hits by score and applies the total limit", () => {
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
      now
    });

    const result = publicContextSearchResult(
      {
        memories: [
          { memory, lexicalScore: 0.7, vectorScore: 0, score: 0.7 }
        ],
        documents: [
          {
            document,
            chunk,
            lexicalScore: 0.9,
            vectorScore: 0,
            score: 0.9
          }
        ],
        knowledge: [
          { node, lexicalScore: 0.8, vectorScore: 0, score: 0.8 }
        ]
      },
      3,
      access
    );

    expect(result.hits.map((hit) => hit.sourceType)).toEqual([
      "document",
      "knowledge",
      "memory"
    ]);
    expect(result).toMatchObject({
      count: 3,
      counts: { memories: 1, documents: 1, knowledge: 1 }
    });
    expect(result.hits[2]).toMatchObject({
      sourceType: "memory",
      memory: { capabilities: { write: true, manage: true } }
    });
  });
});
