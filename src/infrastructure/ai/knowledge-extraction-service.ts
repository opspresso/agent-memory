import { z } from "zod";

import { SafeOperationalError } from "@/infrastructure/observability/safe-operational-error";

import type {
  KnowledgeExtractionOntologyHint,
  KnowledgeExtractionService
} from "@/domain/knowledge/knowledge-extraction-service";
import { defaultKnowledgeOntology } from "@/domain/knowledge/knowledge-ontology";
import type { AiRequestLimiter } from "@/domain/shared/ai-request-limiter";

interface KnowledgeExtractionServiceConfiguration {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly requestLimiter?: AiRequestLimiter;
  readonly request?: typeof fetch;
}

const proposedGraphSchema = z.object({
  entities: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(100),
        kind: z.string().trim().min(1).max(100),
        canonicalName: z.string().trim().min(1).max(500),
        summary: z
          .string()
          .trim()
          .min(1)
          .max(10_000)
          .nullable()
          .optional()
          .transform((summary) => summary ?? undefined)
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

const defaultKindInstruction = `- Prefer these lowercase kinds: ${defaultKnowledgeOntology.nodeKinds.join(", ")}.`;

function ontologyInstructions(
  ontology: KnowledgeExtractionOntologyHint | undefined
): readonly string[] {
  const lines: string[] = [];
  if (ontology && ontology.nodeKinds.length > 0) {
    const kinds = ontology.nodeKinds.join(", ");
    lines.push(
      ontology.mode === "strict"
        ? `- Use only these lowercase kinds defined by the organization: ${kinds}. Omit entities that do not fit a listed kind.`
        : `- Prefer these lowercase kinds defined by the organization: ${kinds}.`
    );
  } else {
    lines.push(defaultKindInstruction);
  }
  if (ontology && ontology.edgePredicates.length > 0) {
    const predicates = ontology.edgePredicates.join(", ");
    lines.push(
      ontology.mode === "strict"
        ? `- Use only these lowercase snake_case predicates defined by the organization: ${predicates}. Omit relationships that do not fit a listed predicate.`
        : `- Prefer these lowercase snake_case predicates defined by the organization: ${predicates}.`
    );
  }
  return lines;
}

function extractionInstructions(
  ontology: KnowledgeExtractionOntologyHint | undefined
): string {
  return `Extract a reviewable knowledge graph from the supplied document chunk.

General rules:
- Extract named real-world or software entities such as products, services, projects, organizations, people, systems, technologies, and locations.
- Use the human-readable name stated in the document as canonicalName.
- Do not use a URL, domain, email address, date, duration, JSON property name, XML tag, or CSV header as an entity when it only describes or locates another named entity.
- Extract only entities and directed relationships supported by the supplied text. Do not invent missing facts.
- Prefer a smaller set of well-supported entities over speculative or structural tokens.
- Use stable local keys and lowercase snake_case predicates.
${ontologyInstructions(ontology).join("\n")}
- Use recognition for awards, honors, achievements, and designations instead of inventing separate kinds.
- Return empty arrays when no reliable knowledge is present.

Format rules:
- Plain text: follow explicit subjects and paragraph context.
- Markdown: treat a heading as the subject of the content beneath it. For a Markdown link that identifies the heading subject, use the visible label as the entity name and treat the URL as supporting information.
- JSON: use object paths and property names only as context for scalar values; do not extract keys as entities by themselves.
- XML: use element paths and attributes only as context for text and attribute values; do not extract tag or attribute names by themselves.
- CSV: interpret every cell using its header and the other cells in the same record; do not extract headers as entities.

Example:
Input Markdown contains heading "Agent Studio", link label "studio.opspresso.com", and text stating that it is a platform for building and operating production AI agents. Extract "Agent Studio" as a product or platform entity. Do not extract "studio.opspresso.com" as an entity.`;
}

function markdownLinkNames(content: string): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const match of content.matchAll(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g)) {
    const label = match[1]?.trim();
    const rawUrl = match[2];
    if (!label || !rawUrl) {
      continue;
    }
    try {
      const url = new URL(rawUrl);
      const precedingContent = content.slice(0, match.index);
      const heading = [...precedingContent.matchAll(/^#{1,6}\s+(.+)$/gm)]
        .at(-1)?.[1]
        ?.trim();
      const entityName =
        label.toLowerCase() === url.hostname.toLowerCase()
          ? heading ?? label
          : label;
      names.set(rawUrl.toLowerCase(), entityName);
      names.set(url.hostname.toLowerCase(), entityName);
    } catch {
      // The structured response remains authoritative for malformed source links.
    }
  }
  return names;
}

function normalizeLinkedEntityNames(
  content: string,
  graph: z.infer<typeof proposedGraphSchema>
): z.infer<typeof proposedGraphSchema> {
  const linkNames = markdownLinkNames(content);
  if (linkNames.size === 0) {
    return graph;
  }
  return {
    ...graph,
    entities: graph.entities.map((entity) => {
      const replacement = linkNames.get(entity.canonicalName.toLowerCase());
      return replacement ? { ...entity, canonicalName: replacement } : entity;
    })
  };
}

function buildResponseJsonSchema(kindEnum?: readonly string[]) {
  return {
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
              kind:
                kindEnum && kindEnum.length > 0
                  ? { type: "string", enum: [...kindEnum] }
                  : { type: "string" },
              canonicalName: { type: "string" },
              summary: { type: ["string", "null"] }
            },
            required: ["key", "kind", "canonicalName", "summary"]
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
}

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

  async function extractGraph(
    input: Parameters<KnowledgeExtractionService["extract"]>[0]
  ) {
    const response = await request(endpoint, {
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: extractionInstructions(input.ontology)
          },
          {
            role: "user",
            content: JSON.stringify({
              documentTitle: input.documentTitle,
              documentType: input.mimeType,
              content: input.content
            })
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: buildResponseJsonSchema(
            input.ontology?.mode === "strict"
              ? input.ontology.nodeKinds
              : undefined
          )
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
        `knowledge extraction request failed with status ${response.status}`,
        { code: "KNOWLEDGE_EXTRACTION_HTTP_ERROR" }
      );
    }
    const completion = completionResponseSchema.safeParse(
      await response.json()
    );
    if (!completion.success) {
      throw new SafeOperationalError(
        "knowledge extraction response is invalid",
        { code: "KNOWLEDGE_EXTRACTION_RESPONSE_INVALID" }
      );
    }
    let content: unknown;
    try {
      content = JSON.parse(completion.data.choices[0]!.message.content);
    } catch {
      throw new SafeOperationalError(
        "knowledge extraction response content is not JSON",
        { code: "KNOWLEDGE_EXTRACTION_RESPONSE_NOT_JSON" }
      );
    }
    const graph = proposedGraphSchema.safeParse(content);
    if (!graph.success) {
      throw new SafeOperationalError("knowledge extraction graph is invalid", {
        code: "KNOWLEDGE_EXTRACTION_GRAPH_INVALID"
      });
    }
    return {
      model,
      graph: normalizeLinkedEntityNames(input.content, graph.data)
    };
  }

  return {
    extract(input) {
      return configuration.requestLimiter
        ? configuration.requestLimiter.run(() => extractGraph(input))
        : extractGraph(input);
    }
  };
}
