import { describe, expect, it, vi } from "vitest";
import { createKnowledgeVerificationService } from "@/infrastructure/ai/knowledge-verification-service";

const input = { content: "유비는 노식의 제자다.", documentTitle: "삼국지", existingKnowledge: [], quotaKey: { organizationId: "org", userId: "user" },
  graph: { entities: [{ key: "liu", kind: "person", canonicalName: "유비" }, { key: "lu", kind: "person", canonicalName: "노식" }], relationships: [{ sourceKey: "liu", targetKey: "lu", predicate: "student_of" }] } };
const itemIds = ["entity:liu", "entity:lu", "relationship:0"];
const judgement = { support: "explicit", usefulness: "useful", conflict: false, evidence: input.content, reason: "The source states the relationship." };
const responseFor = (items: Record<string, unknown>) => Response.json({ choices: [{ message: { content: JSON.stringify({ items }) } }] });
describe("independent knowledge verification", () => {
  it("sends source, original item IDs and existing knowledge to a separate structured request", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor(Object.fromEntries(itemIds.map((id) => [id, judgement]))));
    const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
    const result = await service.verify(input);
    expect(result.items.map((item) => item.item)).toEqual(itemIds);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(body.messages[0].content).toContain("Independently audit");
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ content: input.content, facts: [
      { item: "entity:liu", key: "liu", name: "유비" }, { item: "entity:lu", key: "lu", name: "노식" },
      { item: "relationship:0", source: "liu", target: "lu" }
    ] });
    expect(body.response_format.type).toBe("json_schema");
    const schema = body.response_format.json_schema.schema.properties.items;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(itemIds);
    expect(Object.keys(schema.properties)).toEqual(itemIds);
    expect(schema.additionalProperties).toBe(false);
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
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ items }) } }] }));
    const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
    const graph = { ...input.graph, entities: input.graph.entities.map((entity, index) => index === 0 ? { ...entity, aliases: ["현덕", "장군"] } : entity) };
    const result = await service.verify({ ...input, graph });
    expect(result.items.map((item) => item.item)).toEqual(itemIds);
    expect(result.aliases).toEqual([
      { entityKey: "liu", alias: "현덕", identity: "same_entity", evidence: input.content, reason: "An explicit courtesy name." },
      { entityKey: "liu", alias: "장군", identity: "generic_reference", evidence: input.content, reason: "An office can be held by multiple people." }
    ]);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(JSON.parse(body.messages[1].content).facts).toContainEqual(expect.objectContaining({ item: "alias:liu:1", type: "alias", alias: "장군" }));
    expect(body.response_format.json_schema.schema.properties.items.properties["alias:liu:1"].required).toEqual(["identity", "evidence", "reason"]);
  });
  it("fails closed when alias judgements are omitted or use the entity judgement shape", async () => {
    const graph = { ...input.graph, entities: input.graph.entities.map((entity, index) => index === 0 ? { ...entity, aliases: ["현덕"] } : entity) };
    for (const aliasItems of [{}, { "alias:liu:0": judgement }]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(responseFor({ ...Object.fromEntries(itemIds.map((id) => [id, judgement])), ...aliasItems }));
      const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
      await expect(service.verify({ ...input, graph })).rejects.toThrow(/knowledge verification response/);
    }
  });
  it("fails closed for malformed or unavailable verification without exposing source text", async () => {
    for (const response of [new Response("error", { status: 503 }), Response.json({ choices: [{ message: { content: "invalid" } }] })]) {
      const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request: vi.fn<typeof fetch>().mockResolvedValue(response) });
      await expect(service.verify(input)).rejects.toThrow(/knowledge verification/);
    }
  });
});
