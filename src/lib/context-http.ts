import type { ContextSearchResult } from "@/application/context/search-context";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

import { publicDocumentHit } from "./document-http";
import { publicKnowledgeHit } from "./knowledge-http";
import { publicMemory, publicMemoryForAccess } from "./memory-http";

export function publicContextSearchResult(
  result: ContextSearchResult,
  access?: OrganizationAccess
) {
  const hits = result.hits.map((hit) => {
    const ranking = {
      candidateScore: hit.candidateScore,
      ...(hit.rerankScore !== undefined
        ? { rerankScore: hit.rerankScore }
        : {})
    };
    if (hit.sourceType === "memory") {
      return {
        ...hit,
        ...ranking,
        memory: access
          ? publicMemoryForAccess(hit.memory, access)
          : publicMemory(hit.memory)
      };
    }
    if (hit.sourceType === "document") {
      return {
        ...publicDocumentHit(hit),
        ...ranking,
        sourceType: hit.sourceType
      };
    }
    return {
      ...publicKnowledgeHit(hit),
      ...ranking,
      sourceType: hit.sourceType
    };
  });

  return {
    hits,
    count: hits.length,
    counts: result.counts,
    ranking: result.ranking
  };
}
