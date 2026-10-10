import type { ProposedKnowledgeEntity } from "./knowledge-candidate";

export interface KnowledgeExtractionCheckpointKey {
  readonly organizationId: string;
  readonly chunkId: string;
  readonly fingerprint: string;
}

/** A completed entity pass, never an approved or publicly reviewable graph. */
export interface KnowledgeExtractionCheckpoint extends KnowledgeExtractionCheckpointKey {
  readonly model: string;
  readonly entities: readonly ProposedKnowledgeEntity[];
}

export interface KnowledgeExtractionCheckpointRepository {
  find(key: KnowledgeExtractionCheckpointKey): Promise<KnowledgeExtractionCheckpoint | null>;
  /** Concurrent writers reuse the first committed result for the same input. */
  save(checkpoint: KnowledgeExtractionCheckpoint): Promise<KnowledgeExtractionCheckpoint>;
}
