import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type { KnowledgeSource } from "@/domain/knowledge/knowledge-graph";
import { canAccessMemory } from "@/domain/memory/memory-access";
import { isMemoryActiveAt } from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";
import { scopeCovers } from "@/domain/identity/scope-coverage";

export interface AuthorizeKnowledgeSourceDependencies {
  readonly clock: () => Date;
  readonly documentRepository: Pick<DocumentRepository, "findChunkById">;
  readonly memoryRepository: Pick<MemoryRepository, "findById">;
}

export class KnowledgeSourceNotFoundError extends Error {
  constructor() {
    super("knowledge source not found");
    this.name = "KnowledgeSourceNotFoundError";
  }
}

export type AuthorizeKnowledgeSource = (
  access: OrganizationAccess,
  source: KnowledgeSource,
  targetScope: ScopedResource
) => Promise<void>;

export function buildAuthorizeKnowledgeSource(
  dependencies: AuthorizeKnowledgeSourceDependencies
): AuthorizeKnowledgeSource {
  return async function execute(access, source, targetScope) {
    if (source.memoryId) {
      const memory = await dependencies.memoryRepository.findById(
        access.organizationId,
        source.memoryId
      );
      if (
        !memory ||
        !isMemoryActiveAt(memory, dependencies.clock()) ||
        !canAccessMemory(access, "read", memory) ||
        !scopeCovers(memory.scope, targetScope)
      ) {
        throw new KnowledgeSourceNotFoundError();
      }
      return;
    }

    if (source.chunkId) {
      const record = await dependencies.documentRepository.findChunkById(
        access.organizationId,
        source.chunkId
      );
      if (
        !record ||
        record.document.status !== "ready" ||
        !canAccessScopedResource(access, "read", record.document.scope) ||
        !scopeCovers(record.document.scope, targetScope)
      ) {
        throw new KnowledgeSourceNotFoundError();
      }
    }
  };
}
