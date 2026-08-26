import { randomUUID } from "node:crypto";

import { buildArchiveMemory } from "@/application/memory/archive-memory";
import { buildCreateMemory } from "@/application/memory/create-memory";
import { buildGetMemory } from "@/application/memory/get-memory";
import { buildReviseMemory } from "@/application/memory/revise-memory";
import { buildSearchMemories } from "@/application/memory/search-memories";

import { memoryEmbeddingService, memoryRepository } from "./container";

const clock = () => new Date();

export const createMemoryRecord = buildCreateMemory({
  clock,
  generateId: randomUUID,
  repository: memoryRepository,
  ...(memoryEmbeddingService ? { embeddingService: memoryEmbeddingService } : {})
});

export const getMemoryRecord = buildGetMemory(memoryRepository);

export const reviseMemoryRecord = buildReviseMemory({
  clock,
  repository: memoryRepository,
  ...(memoryEmbeddingService ? { embeddingService: memoryEmbeddingService } : {})
});

export const archiveMemoryRecord = buildArchiveMemory({
  clock,
  repository: memoryRepository
});

export const searchMemoryRecords = buildSearchMemories({
  clock,
  repository: memoryRepository,
  ...(memoryEmbeddingService ? { embeddingService: memoryEmbeddingService } : {})
});
