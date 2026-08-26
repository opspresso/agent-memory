import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type {
  KnowledgeGraphRepository,
  KnowledgeNodeSearchHit
} from "@/domain/knowledge/knowledge-graph-repository";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

export interface SearchKnowledgeNodesDependencies {
  readonly embeddingService?: TextEmbeddingService;
  readonly repository: KnowledgeGraphRepository;
}

export class InvalidKnowledgeSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledgeSearchError";
  }
}

export function buildSearchKnowledgeNodes(
  dependencies: SearchKnowledgeNodesDependencies
) {
  return async function execute(
    access: OrganizationAccess,
    query: string,
    limit = 10
  ): Promise<readonly KnowledgeNodeSearchHit[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0 || normalizedQuery.length > 10_000) {
      throw new InvalidKnowledgeSearchError(
        "knowledge search query must contain between 1 and 10000 characters"
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InvalidKnowledgeSearchError(
        "knowledge search limit must be between 1 and 100"
      );
    }

    const queryEmbedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(normalizedQuery)
      : undefined;
    const hits = await dependencies.repository.searchNodes({
      access,
      query: normalizedQuery,
      ...(queryEmbedding ? { queryEmbedding } : {}),
      limit
    });
    return hits.filter((hit) =>
      canAccessScopedResource(access, "read", hit.node.scope)
    );
  };
}
