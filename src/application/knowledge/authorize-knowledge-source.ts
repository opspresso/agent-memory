import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type { KnowledgeSource } from "@/domain/knowledge/knowledge-graph";
import { canAccessMemory } from "@/domain/memory/memory-access";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

export interface AuthorizeKnowledgeSourceDependencies {
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

function sourceCoversScope(
  sourceScope: ScopedResource,
  targetScope: ScopedResource
): boolean {
  if (sourceScope.organizationId !== targetScope.organizationId) {
    return false;
  }
  if (sourceScope.kind === "organization") {
    return true;
  }
  if (sourceScope.kind !== targetScope.kind) {
    return false;
  }
  if (sourceScope.kind === "team" && targetScope.kind === "team") {
    return sourceScope.teamId === targetScope.teamId;
  }
  return (
    sourceScope.kind === "user" &&
    targetScope.kind === "user" &&
    sourceScope.userId === targetScope.userId
  );
}

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
        memory.status !== "active" ||
        !canAccessMemory(access, "read", memory) ||
        !sourceCoversScope(memory.scope, targetScope)
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
        !sourceCoversScope(record.document.scope, targetScope)
      ) {
        throw new KnowledgeSourceNotFoundError();
      }
    }
  };
}
