import type { ContextSearchResult } from "@/application/context/search-context";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

import { publicDocumentHit } from "./document-http";
import { publicKnowledgeHit } from "./knowledge-http";
import { publicMemory, publicMemoryForAccess } from "./memory-http";

export function publicContextSearchResult(
  result: ContextSearchResult,
  limit: number,
  access?: OrganizationAccess
) {
  const hits = [
    ...result.memories.map((hit) => ({
      ...hit,
      sourceType: "memory" as const,
      memory: access
        ? publicMemoryForAccess(hit.memory, access)
        : publicMemory(hit.memory)
    })),
    ...result.documents.map((hit) => ({
      ...publicDocumentHit(hit),
      sourceType: "document" as const
    })),
    ...result.knowledge.map((hit) => ({
      ...publicKnowledgeHit(hit),
      sourceType: "knowledge" as const
    }))
  ]
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit);

  return {
    hits,
    total: hits.length,
    totals: {
      memories: result.memories.length,
      documents: result.documents.length,
      knowledge: result.knowledge.length
    }
  };
}
