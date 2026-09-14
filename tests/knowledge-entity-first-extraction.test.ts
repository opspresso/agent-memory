import { describe, expect, it, vi } from "vitest";
import { createEntityFirstKnowledgeExtractionService } from "@/infrastructure/ai/knowledge-entity-first-extraction-service";
import type { AiRequestLimiter } from "@/domain/shared/ai-request-limiter";

const content = "조운은 유비를 섬겼다.";
const entities = [{ key:"e0",kind:"person",canonicalName:"조운",aliases:[],summary:null,evidence:[content] },
  { key:"e1",kind:"person",canonicalName:"유비",aliases:[],summary:null,evidence:[content] }];
const relationship = { sourceKey:"e0",targetKey:"e1",predicate:"serves",evidence:[content] };
const response = (value:unknown) => {
  const graph = value as { entities?:readonly Record<string,unknown>[]; relationships?:readonly Record<string,unknown>[] };
  const withIds = (rows:readonly Record<string,unknown>[]) => rows.map((row) => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== "evidence")),evidenceIds:row.evidenceIds??["s0"] }));
  return Response.json({ choices:[{ message:{ content:JSON.stringify({ ...(graph.entities?{ entities:withIds(graph.entities) }:{}),...(graph.relationships?{ relationships:withIds(graph.relationships) }:{}) }) } }] });
};
const input = { content,documentTitle:"Fixture",mimeType:"text/plain",quotaKey:{ organizationId:"org",userId:"user" } };

describe("entity-first knowledge extraction", () => {
  it("validates entities before constraining relationship endpoints to their surviving keys", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ entities:[...entities,
      { ...entities[0]!,key:"bad",kind:"concept",canonicalName:"조운의 유비 섬김" }] }))
      .mockResolvedValueOnce(response({ relationships:[relationship,{ ...relationship,sourceKey:"bad" },{ ...relationship,sourceKey:"missing" }] }));
    const quotaCalls = vi.fn();
    const requestLimiter: AiRequestLimiter = { run(operation,quotaKey) { quotaCalls(quotaKey); return operation(); } };
    const service = createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"test",request,requestLimiter });
    expect((await service.extract(input)).graph).toMatchObject({ entities:entities.map((entity) => ({ ...entity,summary:undefined })),relationships:[relationship] });
    expect(request).toHaveBeenCalledTimes(2);
    expect(quotaCalls).toHaveBeenCalledTimes(2);
    expect(quotaCalls.mock.calls.every((call) => call[0] === input.quotaKey)).toBe(true);
    const first = JSON.parse(request.mock.calls[0]![1]!.body as string);
    const second = JSON.parse(request.mock.calls[1]![1]!.body as string);
    expect(first.response_format.json_schema.schema.required).toEqual(["entities"]);
    expect(first.response_format.json_schema.schema.properties.entities.items.properties).not.toHaveProperty("key");
    expect(first.response_format.json_schema.schema.$defs.sourceEvidence.enum).toEqual(["s0"]);
    expect(second.response_format.json_schema.schema.$defs.sourceEvidence.enum).toEqual(["s0"]);
    expect(first.response_format.json_schema.schema.properties.entities.items.properties.evidenceIds.items).toEqual({ $ref:"#/$defs/sourceEvidence" });
    expect(second.response_format.json_schema.schema.required).toEqual(["relationships"]);
    const properties = second.response_format.json_schema.schema.properties.relationships.items.properties;
    expect(properties.sourceKey.enum).toEqual(["e0","e1"]);
    expect(properties.targetKey.enum).toEqual(["e0","e1"]);
    expect(JSON.parse(second.messages[1].content).entities).toHaveLength(2);
  });

  it("accepts an empty relationship result without inventing a connection between supported entities", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ entities })).mockResolvedValueOnce(response({ relationships:[] }));
    const service = createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"test",request });
    const result = await service.extract(input);
    expect(result.graph.entities).toHaveLength(2);
    expect(result.graph.relationships).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("preserves a singleton concept and skips the relationship request", async () => {
    const source = "멱등성은 반복 실행해도 결과가 동일한 성질이다.";
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ entities:[{ key:"idempotency",kind:"concept",canonicalName:"멱등성",aliases:[],summary:null,evidence:[source] }] }));
    const service = createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"test",request });
    expect((await service.extract({ ...input,content:source })).graph.entities[0]?.canonicalName).toBe("멱등성");
    expect(request).toHaveBeenCalledOnce();
  });
  it("assigns neutral keys after extraction instead of trusting type-bearing model keys", async () => {
    const source = "Orbit는 소프트웨어 제품이다.";
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ entities:[{
      key:"organization_guess",kind:"product",canonicalName:"Orbit",summary:null,aliases:[],evidence:[source]
    }] }));
    const service = createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"test",request });
    expect((await service.extract({ ...input,content:source })).graph.entities[0]).toMatchObject({ key:"e0",kind:"product",canonicalName:"Orbit" });
  });

  it("enforces strict vocabulary in code when a provider ignores the JSON schema", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ entities })).mockResolvedValueOnce(response({ relationships:[relationship] }));
    const service = createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"test",request });
    expect((await service.extract({ ...input,ontology:{ mode:"strict",nodeKinds:["person"],edgePredicates:["student_of"] } })).graph.relationships).toEqual([]);
    request.mockReset();
    expect((await service.extract({ ...input,ontology:{ mode:"strict",nodeKinds:["relationship"],edgePredicates:[] } })).graph.entities).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not return a partial graph when relationship extraction fails", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ entities })).mockResolvedValueOnce(new Response("private provider error",{ status:503 }));
    const service = createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"test",request });
    await expect(service.extract(input)).rejects.toMatchObject({ code:"KNOWLEDGE_EXTRACTION_HTTP_ERROR",message:"knowledge extraction request failed with status 503" });
  });
  it("rejects invented evidence IDs even when a provider ignores constrained decoding", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ entities:[{
      kind:"person",canonicalName:"조운",summary:null,aliases:[],evidenceIds:["invented"]
    }] }));
    const service = createEntityFirstKnowledgeExtractionService({ baseUrl:"http://model.test/v1",model:"test",request });
    await expect(service.extract(input)).rejects.toThrow("unknown source evidence ID");
    expect(request).toHaveBeenCalledOnce();
  });
});
