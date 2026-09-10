import type { ProposedKnowledgeGraph } from "./knowledge-candidate";
import type { AiRequestQuotaKey } from "../shared/ai-request-limiter";

export type KnowledgeExtractionLanguage = "source" | "ko" | "en";

export interface KnowledgeExtractionResult {
  readonly model: string;
  readonly graph: ProposedKnowledgeGraph;
}

export interface KnowledgeExtractionOntologyHint {
  readonly nodeKinds: readonly string[];
  readonly edgePredicates: readonly string[];
  readonly mode: "warn" | "strict";
}

export interface KnowledgeExtractionService {
  extract(input: {
    readonly content: string;
    readonly documentTitle: string;
    readonly mimeType: string;
    readonly ontology?: KnowledgeExtractionOntologyHint;
    readonly quotaKey?: AiRequestQuotaKey;
  }): Promise<KnowledgeExtractionResult>;
}
