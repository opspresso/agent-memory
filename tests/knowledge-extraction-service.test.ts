import { describe, expect, it, vi } from "vitest";

import { createKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-extraction-service";

describe("knowledge extraction service", () => {
  it("requests a bounded structured graph from an OpenAI-compatible endpoint", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                entities: [
                  {
                    key: "api",
                    kind: "service",
                    canonicalName: "Memory API",
                    aliases: [],
                    evidence: ["Memory API stores data in PostgreSQL."],
                    summary: null
                  },
                  {
                    key: "db",
                    kind: "database",
                    canonicalName: "PostgreSQL",
                    aliases: [],
                    evidence: ["Memory API stores data in PostgreSQL."],
                    summary: "Stores Agent Memory data"
                  }
                ],
                relationships: [
                  { sourceKey: "api", targetKey: "db", predicate: "stores_in", evidence: ["Memory API stores data in PostgreSQL."] }
                ]
              })
            }
          }
        ]
      })
    );
    const service = createKnowledgeExtractionService({
      apiKey: "test-key",
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "test/model",
      request
    });

    await expect(
      service.extract({
        documentTitle: "Architecture",
        mimeType: "text/plain",
        content: "Memory API stores data in PostgreSQL."
      })
    ).resolves.toMatchObject({
      model: "test/model",
      graph: {
        entities: [{ key: "api" }, { key: "db" }],
        relationships: [{ predicate: "stores_in" }]
      }
    });
    expect(request).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
    const body = JSON.parse(
      vi.mocked(request).mock.calls[0]?.[1]?.body as string
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "test/model",
      messages: [
        { content: expect.stringContaining("Markdown: preserve the ancestor heading scope") },
        {
          content: JSON.stringify({
            documentTitle: "Architecture",
            documentType: "text/plain",
            content: "Memory API stores data in PostgreSQL."
          })
        }
      ],
      response_format: { type: "json_schema" },
      temperature: 0
    });
    expect(
      (
        body.response_format as {
          json_schema: {
            schema: {
              properties: {
                entities: { items: { required: string[] } };
              };
            };
          };
        }
      ).json_schema.schema.properties.entities.items.required
    ).toContain("summary");
    expect(
      (body.messages as readonly { content: string }[])[0]?.content
    ).toContain("Use recognition for awards");
  });

  it("injects the organization ontology into the prompt and constrains kinds in strict mode", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ entities: [], relationships: [] })
            }
          }
        ]
      })
    );
    const service = createKnowledgeExtractionService({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      request
    });

    await service.extract({
      documentTitle: "Architecture",
      mimeType: "text/plain",
      content: "content",
      ontology: {
        mode: "strict",
        nodeKinds: ["service", "database"],
        edgePredicates: ["depends_on"]
      }
    });

    const body = JSON.parse(
      vi.mocked(request).mock.calls[0]?.[1]?.body as string
    ) as {
      messages: readonly { content: string }[];
      response_format: {
        json_schema: {
          schema: {
            properties: {
              entities: { items: { properties: { kind: { enum?: string[] } } } };
            };
          };
        };
      };
    };
    expect(body.messages[0]?.content).toContain(
      "Use only these lowercase kinds defined by the organization: service, database."
    );
    expect(body.messages[0]?.content).toContain(
      "Use only these lowercase snake_case predicates defined by the organization: depends_on."
    );
    expect(
      body.response_format.json_schema.schema.properties.entities.items
        .properties.kind.enum
    ).toEqual(["service", "database"]);
  });

  it("prefers ontology terms without an enum in warn mode", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ entities: [], relationships: [] })
            }
          }
        ]
      })
    );
    const service = createKnowledgeExtractionService({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      request
    });

    await service.extract({
      documentTitle: "Architecture",
      mimeType: "text/plain",
      content: "content",
      ontology: { mode: "warn", nodeKinds: ["service"], edgePredicates: [] }
    });

    const body = JSON.parse(
      vi.mocked(request).mock.calls[0]?.[1]?.body as string
    ) as {
      messages: readonly { content: string }[];
      response_format: {
        json_schema: {
          schema: {
            properties: {
              entities: { items: { properties: { kind: { enum?: string[] } } } };
            };
          };
        };
      };
    };
    expect(body.messages[0]?.content).toContain(
      "Prefer these lowercase kinds defined by the organization: service."
    );
    expect(
      body.response_format.json_schema.schema.properties.entities.items
        .properties.kind.enum
    ).toBeUndefined();
  });

  it("rejects malformed model output without exposing source content or credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "not-json" } }]
      })
    );
    const service = createKnowledgeExtractionService({
      apiKey: "secret-key",
      baseUrl: "https://example.test/v1",
      model: "test/model",
      request
    });
    const result = service.extract({
      documentTitle: "Private",
      mimeType: "text/plain",
      content: "private document content"
    });

    await expect(result).rejects.toThrow(
      "knowledge extraction response content is not JSON"
    );
    await expect(result).rejects.not.toThrow("private document content");
    await expect(result).rejects.not.toThrow("secret-key");
  });

  it("rejects relationships with missing entity endpoints", async () => {
    const service = createKnowledgeExtractionService({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      request: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entities: [],
                  relationships: [
                    { sourceKey: "missing", targetKey: "other", predicate: "calls" }
                  ]
                })
              }
            }
          ]
        })
      )
    });

    await expect(
      service.extract({
        documentTitle: "Invalid",
        mimeType: "application/json",
        content: "content"
      })
    ).rejects.toThrow("knowledge extraction graph is invalid");
  });

  it("keeps grounded facts when the model also proposes missing endpoints or self-relations", async () => {
    const content = "Memory API stores data in PostgreSQL.";
    const evidence = [content];
    const entities = [
      { key: "api", kind: "service", canonicalName: "Memory API", aliases: [], summary: null, evidence },
      { key: "db", kind: "database", canonicalName: "PostgreSQL", aliases: [], summary: null, evidence }
    ];
    const valid = { sourceKey: "api", targetKey: "db", predicate: "stores_in", evidence };
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      entities, relationships: [valid,
        { ...valid, targetKey: "missing" },
        { ...valid, sourceKey: "missing" },
        { ...valid, targetKey: "api" },
        { ...valid, predicate: "invented", evidence: ["An invented assertion."] }
      ]
    }) } }] }));
    const service = createKnowledgeExtractionService({ baseUrl: "https://example.test/v1", model: "test", request });
    await expect(service.extract({ documentTitle: "Architecture", mimeType: "text/plain", content }))
      .resolves.toMatchObject({ graph: { entities: entities.map((entity) => ({ ...entity, summary: undefined })), relationships: [valid] } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("excludes ambiguous duplicate keys and their relationships while retaining independent facts", async () => {
    const content = "Memory API stores data in PostgreSQL.";
    const entity = { key: "same", kind: "service", canonicalName: "Memory API", aliases: [], summary: null, evidence: [content] };
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      entities: [entity, { ...entity, canonicalName: "PostgreSQL" }, { ...entity, key: "independent" }],
      relationships: [{ sourceKey: "same", targetKey: "independent", predicate: "uses", evidence: [content] }]
    }) } }] }));
    const service = createKnowledgeExtractionService({ baseUrl: "https://example.test/v1", model: "test", request });
    await expect(service.extract({ documentTitle: "Architecture", mimeType: "text/plain", content }))
      .resolves.toMatchObject({ graph: { entities: [{ key: "independent" }], relationships: [] } });
  });

  it("normalizes a Markdown URL entity to its visible product name", async () => {
    const service = createKnowledgeExtractionService({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      request: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  entities: [
                    {
                      key: "studio",
                      kind: "product",
                      canonicalName: "studio.opspresso.com",
                      aliases: [],
                      evidence: ["### Agent Studio"],
                      summary: "A production AI agent platform"
                    }
                  ],
                  relationships: []
                })
              }
            }
          ]
        })
      )
    });

    await expect(
      service.extract({
        documentTitle: "Portfolio",
        mimeType: "text/markdown",
        content:
          "### Agent Studio\n\n[studio.opspresso.com](https://studio.opspresso.com)"
      })
    ).resolves.toMatchObject({
      graph: {
        entities: [{ canonicalName: "Agent Studio" }]
      }
    });
  });
});
