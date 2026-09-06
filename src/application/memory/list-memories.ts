import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { MemoryLibraryReader } from "@/domain/memory/memory-repository";
import { isMemoryActiveAt } from "@/domain/memory/memory";
import { canAccessMemory } from "@/domain/memory/memory-access";
import { InvalidMemorySearchError } from "./search-memories";

export function buildListMemories(repository: MemoryLibraryReader, clock: () => Date) {
  return async (access: OrganizationAccess, limit = 25, offset = 0) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > Number.MAX_SAFE_INTEGER - 101) {
      throw new InvalidMemorySearchError("invalid library pagination");
    }
    const now = clock();
    const rows = await repository.list({ access, now, limit: limit + 1, offset });
    const readable = rows.filter((memory) => isMemoryActiveAt(memory, now) && canAccessMemory(access, "read", memory));
    return { memories: readable.slice(0, limit), nextOffset: readable.length > limit ? offset + limit : null };
  };
}
