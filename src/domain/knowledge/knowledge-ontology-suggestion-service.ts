import type { KnowledgeOntology } from "./knowledge-ontology";
import type { KnowledgeOntologyTermUsageSummary } from "./knowledge-term-usage";
import type { AiRequestQuotaKey } from "../shared/ai-request-limiter";

export interface KnowledgeOntologySuggestionService {
  suggest(input: {
    readonly usage: KnowledgeOntologyTermUsageSummary;
    readonly ontology: KnowledgeOntology;
    readonly quotaKey?: AiRequestQuotaKey;
  }): Promise<KnowledgeOntology>;
}
