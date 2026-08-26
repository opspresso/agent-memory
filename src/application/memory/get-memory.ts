import { canAccessMemory } from "@/domain/memory/memory-access";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { Memory } from "@/domain/memory/memory";
import type { MemoryRepository } from "@/domain/memory/memory-repository";

export class MemoryNotFoundError extends Error {
  constructor() {
    super("memory not found");
    this.name = "MemoryNotFoundError";
  }
}

export function buildGetMemory(repository: MemoryRepository) {
  return async function execute(
    access: OrganizationAccess,
    memoryId: string
  ): Promise<Memory> {
    const memory = await repository.findById(access.organizationId, memoryId);
    if (
      !memory ||
      memory.status !== "active" ||
      !canAccessMemory(access, "read", memory)
    ) {
      throw new MemoryNotFoundError();
    }

    return memory;
  };
}
