import { describe, expect, it, vi } from "vitest";

import { createKnowledgeOntologySuggestionService } from "@/infrastructure/ai/knowledge-ontology-suggestion-service";

const usage = {
  nodeKinds: [{ term: "pipeline", count: 3 }],
  edgePredicates: [{ term: "stores_in", count: 2 }]
} as const;
const ontology = {
  nodeKinds: ["service"],
  edgePredicates: ["depends_on"]
} as const;

describe("knowledge ontology suggestion service", () => {
  it("requests a structured suggestion with the current dictionary and usage", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                nodeKinds: ["pipeline"],
                edgePredicates: ["stores_in"]
              })
            }
          }
        ]
      })
    );
    const service = createKnowledgeOntologySuggestionService({
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "test/model",
      request
    });

    await expect(service.suggest({ usage, ontology })).resolves.toEqual({
      nodeKinds: ["pipeline"],
      edgePredicates: ["stores_in"]
    });
    const body = JSON.parse(
      vi.mocked(request).mock.calls[0]?.[1]?.body as string
    ) as {
      messages: readonly { content: string }[];
      response_format: { json_schema: { name: string } };
    };
    expect(body.messages[0]?.content).toContain("Merge synonyms");
    expect(body.messages[1]?.content).toContain('"pipeline"');
    expect(body.messages[1]?.content).toContain('"depends_on"');
    expect(body.response_format.json_schema.name).toBe(
      "knowledge_ontology_suggestion"
    );
  });

  it("rejects provider failures and malformed suggestions", async () => {
    const failing = createKnowledgeOntologySuggestionService({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      request: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 500 }))
    });
    await expect(failing.suggest({ usage, ontology })).rejects.toThrow(
      "knowledge ontology suggestion request failed with status 500"
    );

    const malformed = createKnowledgeOntologySuggestionService({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      request: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [{ message: { content: JSON.stringify({ nope: true }) } }]
        })
      )
    });
    await expect(malformed.suggest({ usage, ontology })).rejects.toThrow(
      "knowledge ontology suggestion is invalid"
    );
  });
});
