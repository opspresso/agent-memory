import type { KnowledgeOntology } from "./knowledge-ontology";
import type { KnowledgeOntologyTermUsageSummary } from "./knowledge-term-usage";

export interface KnowledgeOntologySuggestionService {
  suggest(input: {
    readonly usage: KnowledgeOntologyTermUsageSummary;
    readonly ontology: KnowledgeOntology;
  }): Promise<KnowledgeOntology>;
}
