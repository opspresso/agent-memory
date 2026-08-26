import { embed, embedMany } from "ai";

import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

export function createTextEmbeddingService(model: string): TextEmbeddingService {
  const modelId = model.trim();
  if (modelId.length === 0) {
    throw new Error("embedding model must not be empty");
  }

  return {
    async embed(text) {
      const result = await embed({ model: modelId, value: text });
      return { model: modelId, values: result.embedding };
    },
    async embedMany(texts) {
      if (texts.length === 0) {
        return [];
      }
      const result = await embedMany({ model: modelId, values: [...texts] });
      return result.embeddings.map((values) => ({ model: modelId, values }));
    }
  };
}
