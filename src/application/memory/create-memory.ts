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
import { canAccessMemory } from "@/domain/memory/memory-access";
import { IngestionConflictError, IngestionReplayError, type IngestionReceipt,
  type IngestionReceiptRepository } from "@/domain/shared/ingestion-receipt";

export interface CreateMemoryInput {
  readonly idempotencyKey?: string;
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
  readonly receipts?: IngestionReceiptRepository;
  readonly fingerprint?: (input: unknown) => string;
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

    const identity = input.idempotencyKey ? { organizationId: input.access.organizationId, userId: input.access.userId,
      operation: "memory.create" as const, key: input.idempotencyKey } : undefined;
    if (identity && (!dependencies.receipts || !dependencies.fingerprint)) throw new Error("idempotent memory creation is not configured");
    const payloadHash = identity ? dependencies.fingerprint!({ kind: input.kind, scope: input.scope,
      title: input.title, content: input.content, source: input.source, accessGrants: input.accessGrants ?? [],
      validFrom: input.validFrom?.toISOString(), expiresAt: input.expiresAt?.toISOString() }) : undefined;
    const reuse = async (receipt: IngestionReceipt): Promise<Memory> => {
      if (receipt.payloadHash !== payloadHash) throw new IngestionConflictError();
      const memory = await dependencies.repository.findById(input.access.organizationId, receipt.resourceId);
      if (!memory || memory.status !== "active" || !canAccessMemory(input.access, "read", memory)) throw new MemoryAccessDeniedError();
      return memory;
    };
    if (identity) {
      const previous = await dependencies.receipts!.find(identity);
      if (previous) return reuse(previous);
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

    try {
      if (identity) {
        await dependencies.repository.save(memory, { ...identity, payloadHash: payloadHash!, resourceId: memory.id, createdAt: now });
      } else {
        await dependencies.repository.save(memory);
      }
    } catch (error) {
      if (error instanceof IngestionReplayError) return reuse(error.receipt);
      throw error;
    }

    return memory;
  };
}
