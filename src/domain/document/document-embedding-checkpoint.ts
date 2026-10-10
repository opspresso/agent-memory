import type { MemoryEmbedding } from "../memory/memory";
import type { DocumentProcessingClaim } from "./document-repository";

export const maxDocumentEmbeddingBatchSize = 64;

export interface DocumentEmbeddingCheckpointKey {
  readonly claim: DocumentProcessingClaim;
  readonly fingerprint: string;
}

export interface DocumentEmbeddingCheckpointRepository {
  find(key: DocumentEmbeddingCheckpointKey): Promise<readonly MemoryEmbedding[] | null>;
  save(key: DocumentEmbeddingCheckpointKey, embeddings: readonly MemoryEmbedding[]): Promise<void>;
}
