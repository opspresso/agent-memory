import { describe, expect, it, vi } from "vitest";
import { createKnowledgeVerificationService } from "@/infrastructure/ai/knowledge-verification-service";

const input = { content: "유비는 노식의 제자다.", documentTitle: "삼국지", existingKnowledge: [], quotaKey: { organizationId: "org", userId: "user" },
  graph: { entities: [{ key: "liu", kind: "person", canonicalName: "유비" }, { key: "lu", kind: "person", canonicalName: "노식" }], relationships: [{ sourceKey: "liu", targetKey: "lu", predicate: "student_of" }] } };
const itemIds = ["entity:liu", "entity:lu", "relationship:0"];
const wireItemIds = ["entity:e0", "entity:e1", "relationship:0"];
const judgement = { representation: "entity", entityKind: "person", support: "explicit", usefulness: "useful", conflict: false, evidence: input.content, reason: "The source states the relationship." };
const responseFor = (items: Record<string, unknown>) => Response.json({ choices: [{ message: { content: JSON.stringify({ items: Object.fromEntries(Object.entries(items).map(([key, value]) => [key.replace(/^entity:liu$/, "entity:e0").replace(/^entity:lu$/, "entity:e1").replace(/^alias:liu:/, "alias:e0:"), { ...(value as Record<string,unknown>),evidenceId:(value as Record<string,unknown>).evidenceId??"s0" }])) }) } }] });
describe("independent knowledge verification", () => {
  it("sends source, opaque item IDs and existing knowledge to a separate structured request", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(Object.fromEntries(itemIds.map((id) => [id, judgement]))));
    const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
    const result = await service.verify(input);
    expect(result.items.map((item) => item.item)).toEqual(itemIds);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(body.messages[0].content).toContain("Independently audit");
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ content: input.content, facts: [
      { item: "entity:e0", key: "e0", name: "유비" }, { item: "entity:e1", key: "e1", name: "노식" },
      { item: "relationship:0", source: "e0", target: "e1" }
    ] });
    expect(JSON.parse(body.messages[1].content).facts[0]).not.toHaveProperty("kind");
    expect(body.response_format.type).toBe("json_schema");
    const schema = body.response_format.json_schema.schema.properties.items;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(wireItemIds);
    expect(Object.keys(schema.properties)).toEqual(wireItemIds);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties["entity:e0"].required).toContain("entityKind");
    expect(Object.keys(schema.properties["entity:e0"].properties)[0]).toBe("entityKind");
    expect(schema.properties["relationship:0"].required).not.toContain("entityKind");
    expect(body.response_format.json_schema.schema.$defs.sourceEvidence.enum).toEqual(["none","s0"]);
    expect(schema.properties["entity:e0"].properties.evidenceId).toEqual({ $ref:"#/$defs/sourceEvidence" });
  });
  it("constrains citations to exact source passages with a shared schema definition", async () => {
    const content = "# 유비\n\n## 스승\n\n노식에게 배웠다.";
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(Object.fromEntries(itemIds.map((id) => [id,{ ...judgement,evidence:content }]))));
    await createKnowledgeVerificationService({ baseUrl:"https://example.test/v1",model:"verifier",request }).verify({ ...input,content });
    const schema = JSON.parse(request.mock.calls[0]![1]!.body as string).response_format.json_schema.schema;
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    const passages = JSON.parse(body.messages[1].content).sourcePassages as { id:string; text:string }[];
    const quotes = passages.map((passage) => passage.text);
    expect(schema.$defs.sourceEvidence.enum).toEqual(["none",...passages.map((passage) => passage.id)]);
    expect(quotes).toContain(content);
    expect(quotes).toContain("# 유비");
    expect(quotes).toContain("노식에게 배웠다.");
    expect(quotes.every((quote) => !quote || content.includes(quote))).toBe(true);
  });
  it("requires an independently inferred kind for every proposed entity", async () => {
    const withoutKind = { ...judgement,entityKind:undefined };
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(Object.fromEntries(itemIds.map((id) => [id,withoutKind]))));
    const service = createKnowledgeVerificationService({ baseUrl:"https://example.test/v1",model:"verifier",request });
    await expect(service.verify(input)).rejects.toMatchObject({ code:"KNOWLEDGE_VERIFICATION_RESPONSE_INVALID" });
  });
  it("removes type-bearing keys from fact IDs, aliases and relation endpoints while restoring original IDs", async () => {
    const graph = { entities:[
      { key:"location_os",kind:"location",canonicalName:"macOS",aliases:["Mac OS"] },
      { key:"organization_app",kind:"organization",canonicalName:"Orbit" }
    ],relationships:[{ sourceKey:"organization_app",targetKey:"location_os",predicate:"runs_on" }] };
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor({
      "entity:e0":{ ...judgement,entityKind:"product" }, "entity:e1":{ ...judgement,entityKind:"product" },
      "relationship:0":{ ...judgement,representation:"relationship" },
      "alias:e0:0":{ identity:"same_entity",evidence:"macOS (Mac OS)",reason:"Explicit alternative name." }
    }));
    const service = createKnowledgeVerificationService({ baseUrl:"https://example.test/v1",model:"verifier",request });
    const result = await service.verify({ ...input,content:"Orbit runs on macOS (Mac OS).",graph });
    const body = request.mock.calls[0]![1]!.body as string;
    expect(body).not.toContain("location_os");
    expect(body).not.toContain("organization_app");
    expect(result.items.map((item) => item.item)).toEqual(["entity:location_os","entity:organization_app","relationship:0"]);
    expect(result.aliases?.[0]).toMatchObject({ entityKey:"location_os",alias:"Mac OS" });
    const facts = JSON.parse(JSON.parse(body).messages[1].content).facts;
    expect(facts.find((fact:{item:string}) => fact.item === "relationship:0")).toMatchObject({ source:"e1",target:"e0" });
    expect(facts.find((fact:{item:string}) => fact.item === "alias:e0:0")).toMatchObject({ entityKey:"e0" });
  });
  it("bounds long display explanations without dropping valid judgements or accepting invented source IDs", async () => {
    const longReason = { ...judgement,reason:"설명".repeat(1_300) };
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(Object.fromEntries(itemIds.map((id) => [id,longReason]))));
    const service = createKnowledgeVerificationService({ baseUrl:"https://example.test/v1",model:"verifier",request });
    const result = await service.verify(input);
    expect(result.items).toHaveLength(3);
    expect(result.items.every((item) => item.reason.length === 1_000 && item.reason.endsWith("…"))).toBe(true);
    expect(result.items[0]).toMatchObject({ support:"explicit",usefulness:"useful",conflict:false,evidence:input.content });
    request.mockResolvedValue(responseFor(Object.fromEntries(itemIds.map((id) => [id,{ ...longReason,evidenceId:"invented" }]))));
    await expect(service.verify(input)).rejects.toMatchObject({ code:"KNOWLEDGE_VERIFICATION_RESPONSE_INVALID" });
  });
  it("rejects omitted or substituted judgements even if the provider ignores its schema", async () => {
    for (const ids of [itemIds.slice(1), ["wrong-id", ...itemIds.slice(1)], [...itemIds, "extra-id"]]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(Object.fromEntries(ids.map((id) => [id, judgement]))));
      const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
      await expect(service.verify(input)).rejects.toMatchObject({ code: "KNOWLEDGE_VERIFICATION_COVERAGE_INVALID" });
    }
  });
  it("does not call a provider for an empty extraction", async () => {
    const request = vi.fn<typeof fetch>();
    const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
    await expect(service.verify({ ...input, graph: { entities: [], relationships: [] } })).resolves.toEqual({ model: "verifier", items: [] });
    expect(request).not.toHaveBeenCalled();
  });
  it("audits alternative proper names separately from entity facts and generic titles", async () => {
    const items = { ...Object.fromEntries(itemIds.map((id) => [id, judgement])),
      "alias:liu:0": { identity: "same_entity", evidence: input.content, reason: "An explicit courtesy name." },
      "alias:liu:1": { identity: "generic_reference", evidence: input.content, reason: "An office can be held by multiple people." }
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(items));
    const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
    const graph = { ...input.graph, entities: input.graph.entities.map((entity, index) => index === 0 ? { ...entity, aliases: ["현덕", "장군"] } : entity) };
    const result = await service.verify({ ...input, graph });
    expect(result.items.map((item) => item.item)).toEqual(itemIds);
    expect(result.aliases).toEqual([
      { entityKey: "liu", alias: "현덕", identity: "same_entity", evidence: input.content, reason: "An explicit courtesy name." },
      { entityKey: "liu", alias: "장군", identity: "generic_reference", evidence: input.content, reason: "An office can be held by multiple people." }
    ]);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(JSON.parse(body.messages[1].content).facts).toContainEqual(expect.objectContaining({ item: "alias:e0:1", type: "alias", alias: "장군" }));
    expect(JSON.parse(body.messages[1].content).facts.every((fact:Record<string,unknown>) => !Object.hasOwn(fact,"kind"))).toBe(true);
    expect(body.response_format.json_schema.schema.properties.items.properties["alias:e0:1"].required).toEqual(["identity", "evidenceId", "reason"]);
  });
  it("fails closed when alias judgements are omitted or use the entity judgement shape", async () => {
    const graph = { ...input.graph, entities: input.graph.entities.map((entity, index) => index === 0 ? { ...entity, aliases: ["현덕"] } : entity) };
    for (const aliasItems of [{}, { "alias:liu:0": judgement }]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor({ ...Object.fromEntries(itemIds.map((id) => [id, judgement])), ...aliasItems }));
      const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
      await expect(service.verify({ ...input, graph })).rejects.toThrow(/knowledge verification response/);
    }
  });
  it("checks descriptive expansions without changing the schema for distinct proper aliases", async () => {
    const graph = { entities:[{ key:"app",kind:"product",canonicalName:"Orbit",aliases:["Orbit platform","Star"] }],relationships:[] };
    const response = { "entity:e0":{ ...judgement,entityKind:"product" },
      "alias:e0:0":{ identity:"same_entity",descriptiveExpansion:true,evidenceId:"s0",reason:"A classification added to the name." },
      "alias:e0:1":{ identity:"same_entity",evidenceId:"s0",reason:"An explicit alternative proper name." }
    };
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(response));
    const service = createKnowledgeVerificationService({ baseUrl:"https://example.test/v1",model:"verifier",request });
    const result = await service.verify({ ...input,content:"Orbit platform is also named Star.",graph });
    expect(result.aliases?.[0]).toMatchObject({ descriptiveExpansion:true,alias:"Orbit platform" });
    expect(result.aliases?.[1]).not.toHaveProperty("descriptiveExpansion");
    const schema = JSON.parse(request.mock.calls[0]![1]!.body as string).response_format.json_schema.schema.properties.items.properties;
    expect(schema["alias:e0:0"].required).toContain("descriptiveExpansion");
    expect(schema["alias:e0:1"].required).not.toContain("descriptiveExpansion");
    request.mockResolvedValue(responseFor({ ...response,"alias:e0:0":{ ...response["alias:e0:0"],descriptiveExpansion:undefined } }));
    await expect(service.verify({ ...input,content:input.content,graph })).rejects.toMatchObject({ code:"KNOWLEDGE_VERIFICATION_RESPONSE_INVALID" });
  });
  it("fails closed for malformed or unavailable verification without exposing source text", async () => {
    for (const response of [new Response("error", { status: 503 }), Response.json({ choices: [{ message: { content: "invalid" } }] })]) {
      const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request: vi.fn<typeof fetch>().mockResolvedValue(response) });
      await expect(service.verify(input)).rejects.toThrow(/knowledge verification/);
    }
  });
});
