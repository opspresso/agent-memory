import {
  createMemory,
  type Memory,
  type MemoryAccessGrant,
  type MemoryKind,
  type MemoryScope,
  type MemorySource
} from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessScopedResource } from "@/domain/identity/organization-access";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

export interface CreateMemoryInput {
  readonly access: OrganizationAccess;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly title: string;
  readonly content: string;
  readonly source: MemorySource;
  readonly accessGrants?: readonly MemoryAccessGrant[];
  readonly validFrom?: Date;
  readonly expiresAt?: Date;
}

export interface CreateMemoryDependencies {
  readonly clock: () => Date;
  readonly generateId: () => string;
  readonly embeddingService?: TextEmbeddingService;
  readonly repository: MemoryRepository;
}

export class MemoryAccessDeniedError extends Error {
  constructor() {
    super("memory access denied");
    this.name = "MemoryAccessDeniedError";
  }
}

export function buildCreateMemory(dependencies: CreateMemoryDependencies) {
  return async function execute(input: CreateMemoryInput): Promise<Memory> {
    const now = dependencies.clock();
    if (
      input.access.principalKind === "organization-agent" &&
      input.accessGrants !== undefined
    ) {
      throw new MemoryAccessDeniedError();
    }
    const action = input.accessGrants === undefined ? "write" : "manage";
    if (!canAccessScopedResource(input.access, action, input.scope)) {
      throw new MemoryAccessDeniedError();
    }

    const memoryWithoutEmbedding = createMemory({
      id: dependencies.generateId(),
      kind: input.kind,
      scope: input.scope,
      title: input.title,
      content: input.content,
      source: input.source,
      ...(input.accessGrants ? { accessGrants: input.accessGrants } : {}),
      createdBy: input.access.userId,
      validFrom: input.validFrom ?? now,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      now
    });
    const embedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(
          `${memoryWithoutEmbedding.title}\n${memoryWithoutEmbedding.content}`,
          {
            organizationId: input.access.organizationId,
            userId: input.access.userId
          }
        )
      : undefined;
    const memory = embedding
      ? createMemory({
          id: memoryWithoutEmbedding.id,
          kind: memoryWithoutEmbedding.kind,
          scope: memoryWithoutEmbedding.scope,
          title: memoryWithoutEmbedding.title,
          content: memoryWithoutEmbedding.content,
          source: memoryWithoutEmbedding.source,
          accessGrants: memoryWithoutEmbedding.accessGrants,
          createdBy: memoryWithoutEmbedding.createdBy,
          validFrom: memoryWithoutEmbedding.validFrom,
          ...(memoryWithoutEmbedding.expiresAt
            ? { expiresAt: memoryWithoutEmbedding.expiresAt }
            : {}),
          embedding,
          now
        })
      : memoryWithoutEmbedding;

    await dependencies.repository.save(memory);

    return memory;
  };
}
