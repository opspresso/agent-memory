import type { ProposedKnowledgeGraph } from "./knowledge-candidate";

export interface KnowledgeExtractionResult {
  readonly model: string;
  readonly graph: ProposedKnowledgeGraph;
}

export interface KnowledgeExtractionService {
  extract(input: {
    readonly content: string;
    readonly documentTitle: string;
  }): Promise<KnowledgeExtractionResult>;
}
