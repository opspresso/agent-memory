import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";
import { archiveMemory } from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

import { MemoryAccessDeniedError } from "./create-memory";
import { MemoryNotFoundError } from "./get-memory";
import { MemoryVersionConflictError } from "./revise-memory";

export interface ArchiveMemoryDependencies {
  readonly clock: () => Date;
  readonly repository: MemoryRepository;
}

export function buildArchiveMemory(dependencies: ArchiveMemoryDependencies) {
  return async function execute(
    access: OrganizationAccess,
    memoryId: string,
    expectedVersion: number,
    changeReason?: string
  ): Promise<void> {
    const existing = await dependencies.repository.findById(
      access.organizationId,
      memoryId
    );
    if (!existing || existing.status !== "active") {
      throw new MemoryNotFoundError();
    }
    if (!canAccessMemory(access, "manage", existing)) {
      throw new MemoryAccessDeniedError();
    }
    if (existing.version !== expectedVersion) {
      throw new MemoryVersionConflictError();
    }

    const archived = archiveMemory(existing, dependencies.clock());
    const result = await dependencies.repository.saveRevision(
      archived,
      expectedVersion,
      access.userId,
      changeReason
    );
    if (result === "not_found") {
      throw new MemoryNotFoundError();
    }
    if (result === "conflict") {
      throw new MemoryVersionConflictError();
    }
  };
}
