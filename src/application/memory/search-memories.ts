import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";
import type { MemoryEmbeddingService } from "@/domain/memory/memory-embedding-service";
import type {
  MemoryRepository,
  MemorySearchHit
} from "@/domain/memory/memory-repository";

export interface SearchMemoriesDependencies {
  readonly clock: () => Date;
  readonly embeddingService?: MemoryEmbeddingService;
  readonly repository: MemoryRepository;
}

export class InvalidMemorySearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemorySearchError";
  }
}

export function buildSearchMemories(dependencies: SearchMemoriesDependencies) {
  return async function execute(
    access: OrganizationAccess,
    query: string,
    limit = 10
  ): Promise<readonly MemorySearchHit[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new InvalidMemorySearchError("memory search query must not be empty");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InvalidMemorySearchError("memory search limit must be between 1 and 100");
    }

    const queryEmbedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(normalizedQuery)
      : undefined;
    const hits = await dependencies.repository.search({
      access,
      query: normalizedQuery,
      ...(queryEmbedding ? { queryEmbedding } : {}),
      now: dependencies.clock(),
      limit
    });

    return hits.filter(
      (hit) =>
        hit.memory.status === "active" &&
        canAccessMemory(access, "read", hit.memory)
    );
  };
}
