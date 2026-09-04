import { z } from "zod";

import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

import type { KnowledgeOntologySuggestionService } from "@/domain/knowledge/knowledge-ontology-suggestion-service";
import type { AiRequestLimiter } from "@/domain/shared/ai-request-limiter";

interface KnowledgeOntologySuggestionServiceConfiguration {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly requestLimiter?: AiRequestLimiter;
  readonly request?: typeof fetch;
}

const suggestionSchema = z.object({
  nodeKinds: z.array(z.string().trim().min(1).max(100)).max(40),
  edgePredicates: z.array(z.string().trim().min(1).max(100)).max(40)
});

const completionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() })
      })
    )
    .min(1)
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

function requiredSetting(value: string, name: string): string {
  const setting = value.trim();
  if (setting.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return setting;
}

export function createKnowledgeOntologySuggestionService(
  configuration: KnowledgeOntologySuggestionServiceConfiguration
): KnowledgeOntologySuggestionService {
  const baseUrl = requiredSetting(
    configuration.baseUrl,
    "knowledge ontology suggestion base URL"
  ).replace(/\/+$/, "");
  const endpoint = new URL(`${baseUrl}/chat/completions`).toString();
  const model = requiredSetting(
    configuration.model,
    "knowledge ontology suggestion model"
  );
  const apiKey = configuration.apiKey?.trim();
  const request = configuration.request ?? fetch;

  async function suggestOntology(
    input: Parameters<KnowledgeOntologySuggestionService["suggest"]>[0]
  ) {
    const response = await request(endpoint, {
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: suggestionInstructions },
          {
            role: "user",
            content: JSON.stringify({
              currentOntology: input.ontology,
              observedUsage: input.usage
            })
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: responseJsonSchema
        },
        temperature: 0
      }),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      method: "POST",
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) {
      throw new SafeOperationalError(
        `knowledge ontology suggestion request failed with status ${response.status}`,
        { code: "KNOWLEDGE_ONTOLOGY_HTTP_ERROR" }
      );
    }
    const completion = completionResponseSchema.safeParse(
      await response.json()
    );
    if (!completion.success) {
      throw new SafeOperationalError(
        "knowledge ontology suggestion response is invalid",
        { code: "KNOWLEDGE_ONTOLOGY_RESPONSE_INVALID" }
      );
    }
    let content: unknown;
    try {
      content = JSON.parse(completion.data.choices[0]!.message.content);
    } catch {
      throw new SafeOperationalError(
        "knowledge ontology suggestion response content is not JSON",
        { code: "KNOWLEDGE_ONTOLOGY_RESPONSE_NOT_JSON" }
      );
    }
    const suggestion = suggestionSchema.safeParse(content);
    if (!suggestion.success) {
      throw new SafeOperationalError(
        "knowledge ontology suggestion is invalid",
        { code: "KNOWLEDGE_ONTOLOGY_SUGGESTION_INVALID" }
      );
    }
    return suggestion.data;
  }

  return {
    suggest(input) {
      return configuration.requestLimiter
        ? configuration.requestLimiter.run(
            () => suggestOntology(input),
            input.quotaKey
          )
        : suggestOntology(input);
    }
  };
}
