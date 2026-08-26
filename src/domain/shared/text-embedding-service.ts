import type { MemoryEmbedding } from "@/domain/memory/memory";

export interface TextEmbeddingService {
  embed(text: string): Promise<MemoryEmbedding>;
  embedMany(texts: readonly string[]): Promise<readonly MemoryEmbedding[]>;
}
