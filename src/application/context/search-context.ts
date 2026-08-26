import type { DocumentSearchHit } from "@/domain/document/document-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { KnowledgeNodeSearchHit } from "@/domain/knowledge/knowledge-graph-repository";
import type { MemorySearchHit } from "@/domain/memory/memory-repository";

export interface ContextSearchResult {
  readonly memories: readonly MemorySearchHit[];
  readonly documents: readonly DocumentSearchHit[];
  readonly knowledge: readonly KnowledgeNodeSearchHit[];
}

export interface ContextSearchDependencies {
  readonly searchMemories: (
    access: OrganizationAccess,
    query: string,
    limit: number
  ) => Promise<readonly MemorySearchHit[]>;
  readonly searchDocuments: (
    access: OrganizationAccess,
    query: string,
    limit: number
  ) => Promise<readonly DocumentSearchHit[]>;
  readonly searchKnowledge: (
    access: OrganizationAccess,
    query: string,
    limit: number
  ) => Promise<readonly KnowledgeNodeSearchHit[]>;
}

export function buildSearchContext(dependencies: ContextSearchDependencies) {
  return async function execute(
    access: OrganizationAccess,
    query: string,
    limit: number
  ): Promise<ContextSearchResult> {
    const [memories, documents, knowledge] = await Promise.all([
      dependencies.searchMemories(access, query, limit),
      dependencies.searchDocuments(access, query, limit),
      dependencies.searchKnowledge(access, query, limit)
    ]);
    return { memories, documents, knowledge };
  };
}
