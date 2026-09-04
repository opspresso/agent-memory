import type { MemoryEmbedding } from "@/domain/memory/memory";
import type { AiRequestQuotaKey } from "./ai-request-limiter";

export interface TextEmbeddingService {
  embed(text: string, quotaKey?: AiRequestQuotaKey): Promise<MemoryEmbedding>;
  embedMany(
    texts: readonly string[],
    quotaKey?: AiRequestQuotaKey
  ): Promise<readonly MemoryEmbedding[]>;
}
