import { z } from "zod";

import type { KnowledgeExtractionService } from "@/domain/knowledge/knowledge-extraction-service";

interface KnowledgeExtractionServiceConfiguration {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly request?: typeof fetch;
}

const proposedGraphSchema = z.object({
  entities: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(100),
        kind: z.string().trim().min(1).max(100),
        canonicalName: z.string().trim().min(1).max(500),
        summary: z.string().trim().min(1).max(10_000).optional()
      })
    )
    .max(100),
  relationships: z
    .array(
      z.object({
        sourceKey: z.string().trim().min(1).max(100),
        targetKey: z.string().trim().min(1).max(100),
        predicate: z.string().trim().min(1).max(100)
      })
    )
    .max(200)
}).superRefine((graph, context) => {
  const keys = new Set(graph.entities.map((entity) => entity.key));
  if (keys.size !== graph.entities.length) {
    context.addIssue({
      code: "custom",
      message: "entity keys must be unique",
      path: ["entities"]
    });
  }
  graph.relationships.forEach((relationship, index) => {
    if (
      !keys.has(relationship.sourceKey) ||
      !keys.has(relationship.targetKey) ||
      relationship.sourceKey === relationship.targetKey
    ) {
      context.addIssue({
        code: "custom",
        message: "relationship endpoints are invalid",
        path: ["relationships", index]
      });
    }
  });
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

const responseJsonSchema = {
  name: "knowledge_candidate",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      entities: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            kind: { type: "string" },
            canonicalName: { type: "string" },
            summary: { type: "string" }
          },
          required: ["key", "kind", "canonicalName"]
        }
      },
      relationships: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceKey: { type: "string" },
            targetKey: { type: "string" },
            predicate: { type: "string" }
          },
          required: ["sourceKey", "targetKey", "predicate"]
        }
      }
    },
    required: ["entities", "relationships"]
  }
} as const;

function requiredSetting(value: string, name: string): string {
  const setting = value.trim();
  if (setting.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return setting;
}

export function createKnowledgeExtractionService(
  configuration: KnowledgeExtractionServiceConfiguration
): KnowledgeExtractionService {
  const baseUrl = requiredSetting(
    configuration.baseUrl,
    "knowledge extraction base URL"
  ).replace(/\/+$/, "");
  const endpoint = new URL(`${baseUrl}/chat/completions`).toString();
  const model = requiredSetting(
    configuration.model,
    "knowledge extraction model"
  );
  const apiKey = configuration.apiKey?.trim();
  const request = configuration.request ?? fetch;

  return {
    async extract(input) {
      const response = await request(endpoint, {
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "Extract only explicit entities and directed relationships from the supplied document chunk. Do not infer facts that are not stated. Use stable local keys, concise lowercase kinds, and lowercase snake_case predicates. Return empty arrays when no reliable knowledge is present."
            },
            {
              role: "user",
              content: JSON.stringify({
                documentTitle: input.documentTitle,
                content: input.content
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
        throw new Error(
          `knowledge extraction request failed with status ${response.status}`
        );
      }
      const completion = completionResponseSchema.safeParse(
        await response.json()
      );
      if (!completion.success) {
        throw new Error("knowledge extraction response is invalid");
      }
      let content: unknown;
      try {
        content = JSON.parse(completion.data.choices[0]!.message.content);
      } catch {
        throw new Error("knowledge extraction response content is not JSON");
      }
      const graph = proposedGraphSchema.safeParse(content);
      if (!graph.success) {
        throw new Error("knowledge extraction graph is invalid");
      }
      return { model, graph: graph.data };
    }
  };
}
