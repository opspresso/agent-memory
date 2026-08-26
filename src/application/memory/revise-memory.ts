import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";
import type { MemoryEmbeddingService } from "@/domain/memory/memory-embedding-service";
import {
  reviseMemory,
  type Memory,
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
  readonly expiresAt?: Date | null;
  readonly changeReason?: string;
}

export interface ReviseMemoryDependencies {
  readonly clock: () => Date;
  readonly embeddingService?: MemoryEmbeddingService;
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
    if (!canAccessMemory(input.access, "write", existing)) {
      throw new MemoryAccessDeniedError();
    }
    if (existing.version !== input.expectedVersion) {
      throw new MemoryVersionConflictError();
    }

    const contentChanged = input.title !== undefined || input.content !== undefined;
    const embedding = contentChanged
      ? dependencies.embeddingService
        ? await dependencies.embeddingService.embed(
            `${input.title?.trim() ?? existing.title}\n${input.content?.trim() ?? existing.content}`
          )
        : null
      : undefined;
    const revised = reviseMemory(existing, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(embedding !== undefined ? { embedding } : {}),
      now: dependencies.clock()
    });
    const result = await dependencies.repository.saveRevision(
      revised,
      input.expectedVersion,
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
