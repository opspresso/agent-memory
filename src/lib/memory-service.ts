import { buildListMemories } from "@/application/memory/list-memories";
import { randomUUID } from "node:crypto";

import { buildArchiveMemory } from "@/application/memory/archive-memory";
import { buildCreateMemory } from "@/application/memory/create-memory";
import { buildGetMemory } from "@/application/memory/get-memory";
import { buildListMemoryVersions } from "@/application/memory/list-memory-versions";
import { buildReviseMemory } from "@/application/memory/revise-memory";
import { buildSearchMemories } from "@/application/memory/search-memories";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import type { MemoryEmbedding } from "@/domain/memory/memory";
import { observeRetrieval } from "@/infrastructure/observability/telemetry";

import { memoryRepository, textEmbeddingService } from "./container";

const clock = () => new Date();

export const createMemoryRecord = buildCreateMemory({
  clock,
  generateId: randomUUID,
  repository: memoryRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const getMemoryRecord = buildGetMemory(memoryRepository);
export const listMemoryVersionRecords =
  buildListMemoryVersions(memoryRepository);

export const reviseMemoryRecord = buildReviseMemory({
  clock,
  repository: memoryRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export const archiveMemoryRecord = buildArchiveMemory({
  clock,
  repository: memoryRepository
});

const searchMemoryRecordsBase = buildSearchMemories({
  clock,
  repository: memoryRepository,
  ...(textEmbeddingService ? { embeddingService: textEmbeddingService } : {})
});

export async function searchMemoryRecords(
  access: OrganizationAccess,
  query: string,
  limit = 10,
  queryEmbedding?: MemoryEmbedding
) {
  return observeRetrieval("memory.search", access, limit, () =>
    searchMemoryRecordsBase(access, query, limit, queryEmbedding)
  );
}

export const listMemoryRecords = buildListMemories(memoryRepository, () => new Date());
