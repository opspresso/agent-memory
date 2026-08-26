import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { canAccessMemory } from "@/domain/memory/memory-access";
import type { MemoryVersionSnapshot } from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

import { MemoryNotFoundError } from "./get-memory";

export function buildListMemoryVersions(repository: MemoryRepository) {
  return async function execute(
    access: OrganizationAccess,
    memoryId: string,
    limit: number,
    beforeVersion?: number
  ): Promise<readonly MemoryVersionSnapshot[]> {
    const memory = await repository.findById(access.organizationId, memoryId);
    if (!memory || !canAccessMemory(access, "manage", memory)) {
      throw new MemoryNotFoundError();
    }
    return repository.listVersions(
      access.organizationId,
      memoryId,
      limit,
      beforeVersion
    );
  };
}
