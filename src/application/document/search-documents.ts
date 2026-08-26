import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type {
  DocumentRepository,
  DocumentSearchHit
} from "@/domain/document/document-repository";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

export interface SearchDocumentsDependencies {
  readonly embeddingService?: TextEmbeddingService;
  readonly repository: DocumentRepository;
}

export class InvalidDocumentSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentSearchError";
  }
}

export function buildSearchDocuments(
  dependencies: SearchDocumentsDependencies
) {
  return async function execute(
    access: OrganizationAccess,
    query: string,
    limit = 10
  ): Promise<readonly DocumentSearchHit[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new InvalidDocumentSearchError(
        "document search query must not be empty"
      );
    }
    if (normalizedQuery.length > 10_000) {
      throw new InvalidDocumentSearchError(
        "document search query must not exceed 10000 characters"
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InvalidDocumentSearchError(
        "document search limit must be between 1 and 100"
      );
    }

    const queryEmbedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(normalizedQuery)
      : undefined;
    const hits = await dependencies.repository.search({
      access,
      query: normalizedQuery,
      ...(queryEmbedding ? { queryEmbedding } : {}),
      limit
    });

    return hits.filter(
      (hit) =>
        hit.document.status === "ready" &&
        canAccessScopedResource(access, "read", hit.document.scope)
    );
  };
}
