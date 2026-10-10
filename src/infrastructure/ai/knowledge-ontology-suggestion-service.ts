import { createKnowledgeStructuredClient, type KnowledgeStructuredClientConfiguration } from "./knowledge-structured-client";
import { z } from "zod";

import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

import type { KnowledgeOntologySuggestionService } from "@/domain/knowledge/knowledge-ontology-suggestion-service";

const suggestionSchema = z.object({
  nodeKinds: z.array(z.string().trim().min(1).max(100)).max(40),
  edgePredicates: z.array(z.string().trim().min(1).max(100)).max(40)
});

const suggestionInstructions = `Curate a knowledge graph ontology for an organization.

You receive the organization's current dictionary and the terms observed in its
extracted knowledge (with usage counts). Propose additional dictionary terms.

Rules:
- Return lowercase node kinds and lowercase snake_case edge predicates.
- Merge synonyms and spelling variants into one canonical term each.
- Prefer observed terms with meaningful usage; generalize overly specific ones.
- Do not repeat terms that are already in the current dictionary.
- Return at most 20 terms per list, ordered by usefulness.
- Return empty arrays when the observed usage adds nothing new.`;

const responseJsonSchema = {
  name: "knowledge_ontology_suggestion",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      nodeKinds: { type: "array", maxItems: 40, items: { type: "string" } },
      edgePredicates: {
        type: "array",
        maxItems: 40,
        items: { type: "string" }
      }
    },
    required: ["nodeKinds", "edgePredicates"]
  }
} as const;

export function createKnowledgeOntologySuggestionService(
  configuration: KnowledgeStructuredClientConfiguration
): KnowledgeOntologySuggestionService {
  const client = createKnowledgeStructuredClient(configuration, "ontology");
  return {
    async suggest(input) {
      const content = await client.generate(suggestionInstructions,
        { currentOntology: input.ontology, observedUsage: input.usage }, responseJsonSchema, input.quotaKey);
      const suggestion = suggestionSchema.safeParse(content);
      if (!suggestion.success) throw new SafeOperationalError("knowledge ontology suggestion is invalid", { code: "KNOWLEDGE_ONTOLOGY_SUGGESTION_INVALID" });
      return suggestion.data;
    }
  };
}
