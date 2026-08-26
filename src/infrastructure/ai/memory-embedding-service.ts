import { embed } from "ai";

import type { MemoryEmbeddingService } from "@/domain/memory/memory-embedding-service";

export function createMemoryEmbeddingService(
  model: string
): MemoryEmbeddingService {
  const modelId = model.trim();
  if (modelId.length === 0) {
    throw new Error("embedding model must not be empty");
  }

  return {
    async embed(text) {
      const result = await embed({ model: modelId, value: text });
      return { model: modelId, values: result.embedding };
    }
  };
}
