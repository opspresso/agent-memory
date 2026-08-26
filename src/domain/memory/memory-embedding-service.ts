import type { MemoryEmbedding } from "./memory";

export interface MemoryEmbeddingService {
  embed(text: string): Promise<MemoryEmbedding>;
}
