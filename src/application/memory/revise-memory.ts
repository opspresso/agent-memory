import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";
import {
  reviseMemory,
  type Memory,
  type MemoryAccessGrant,
  type MemorySource
} from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

import {
  MemoryAccessDeniedError
} from "./create-memory";
import { MemoryNotFoundError } from "./get-memory";

export interface ReviseMemoryInput {
  readonly access: OrganizationAccess;
  readonly memoryId: string;
  readonly expectedVersion: number;
  readonly title?: string;
  readonly content?: string;
  readonly source?: MemorySource;
  readonly accessGrants?: readonly MemoryAccessGrant[];
  readonly expiresAt?: Date | null;
  readonly changeReason?: string;
}

export interface ReviseMemoryDependencies {
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly repository: MemoryRepository;
}

export class MemoryVersionConflictError extends Error {
  constructor() {
    super("memory version conflict");
    this.name = "MemoryVersionConflictError";
  }
}

export function buildReviseMemory(dependencies: ReviseMemoryDependencies) {
  return async function execute(input: ReviseMemoryInput): Promise<Memory> {
    const existing = await dependencies.repository.findById(
      input.access.organizationId,
      input.memoryId
    );
    if (!existing || existing.status !== "active") {
      throw new MemoryNotFoundError();
    }
    const action = input.accessGrants === undefined ? "write" : "manage";
    if (!canAccessMemory(input.access, action, existing)) {
      throw new MemoryAccessDeniedError();
    }
    if (existing.version !== input.expectedVersion) {
      throw new MemoryVersionConflictError();
    }

    const contentChanged = input.title !== undefined || input.content !== undefined;
    const embedding = contentChanged
      ? dependencies.embeddingService
        ? await dependencies.embeddingService.embed(
            `${input.title?.trim() ?? existing.title}\n${input.content?.trim() ?? existing.content}`,
            {
              organizationId: input.access.organizationId,
              userId: input.access.userId
            }
          )
        : null
      : undefined;
    const revised = reviseMemory(existing, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.accessGrants !== undefined
        ? { accessGrants: input.accessGrants }
        : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(embedding !== undefined ? { embedding } : {}),
      now: dependencies.clock()
    });
    const result = await dependencies.repository.saveRevision(
      revised,
      input.expectedVersion,
      input.access.userId,
      input.changeReason
    );
    if (result === "not_found") {
      throw new MemoryNotFoundError();
    }
    if (result === "conflict") {
      throw new MemoryVersionConflictError();
    }

    return revised;
  };
}
