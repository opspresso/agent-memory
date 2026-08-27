import type { DocumentSearchHit } from "@/domain/document/document-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { KnowledgeNodeSearchHit } from "@/domain/knowledge/knowledge-graph-repository";
import type { MemoryEmbedding } from "@/domain/memory/memory";
import type { MemorySearchHit } from "@/domain/memory/memory-repository";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

export interface ContextSearchResult {
  readonly memories: readonly MemorySearchHit[];
  readonly documents: readonly DocumentSearchHit[];
  readonly knowledge: readonly KnowledgeNodeSearchHit[];
}

export interface ContextSearchDependencies {
  readonly searchMemories: (
    access: OrganizationAccess,
    query: string,
    limit: number,
    queryEmbedding?: MemoryEmbedding
  ) => Promise<readonly MemorySearchHit[]>;
  readonly searchDocuments: (
    access: OrganizationAccess,
    query: string,
    limit: number,
    queryEmbedding?: MemoryEmbedding
  ) => Promise<readonly DocumentSearchHit[]>;
  readonly searchKnowledge: (
    access: OrganizationAccess,
    query: string,
    limit: number,
    queryEmbedding?: MemoryEmbedding
  ) => Promise<readonly KnowledgeNodeSearchHit[]>;
  readonly embeddingService?: TextEmbeddingService;
}

export class InvalidContextSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContextSearchError";
  }
}

export function buildSearchContext(dependencies: ContextSearchDependencies) {
  return async function execute(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<ContextSearchResult> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0 || normalizedQuery.length > 10_000) {
      throw new InvalidContextSearchError(
        "context search query must contain between 1 and 10000 characters"
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InvalidContextSearchError(
        "context search limit must be between 1 and 100"
      );
    }
    const queryEmbedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(normalizedQuery)
      : undefined;
    const [memories, documents, knowledge] = await Promise.all([
      dependencies.searchMemories(
        access,
        normalizedQuery,
        limit,
        queryEmbedding
      ),
      dependencies.searchDocuments(
        access,
        normalizedQuery,
        limit,
        queryEmbedding
      ),
      dependencies.searchKnowledge(
        access,
        normalizedQuery,
        limit,
        queryEmbedding
      )
    ]);
    return { memories, documents, knowledge };
  };
}
