import { describe, expect, it, vi } from "vitest";
import { createKnowledgeVerificationService } from "@/infrastructure/ai/knowledge-verification-service";

const input = { content: "유비는 노식의 제자다.", documentTitle: "삼국지", existingKnowledge: [], quotaKey: { organizationId: "org", userId: "user" },
  graph: { entities: [{ key: "liu", kind: "person", canonicalName: "유비" }, { key: "lu", kind: "person", canonicalName: "노식" }], relationships: [{ sourceKey: "liu", targetKey: "lu", predicate: "student_of" }] } };
describe("independent knowledge verification", () => {
  it("sends source, original item IDs and existing knowledge to a separate structured request", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ items: [] }) } }] }));
    const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request });
    await service.verify(input);
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(body.messages[0].content).toContain("Independently audit");
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ content: input.content, facts: [
      { item: "entity:liu", key: "liu", name: "유비" }, { item: "entity:lu", key: "lu", name: "노식" },
      { item: "relationship:0", source: "liu", target: "lu" }
    ] });
    expect(body.response_format.type).toBe("json_schema");
  });
  it("fails closed for malformed or unavailable verification without exposing source text", async () => {
    for (const response of [new Response("error", { status: 503 }), Response.json({ choices: [{ message: { content: "invalid" } }] })]) {
      const service = createKnowledgeVerificationService({ baseUrl: "https://example.test/v1", model: "verifier", request: vi.fn<typeof fetch>().mockResolvedValue(response) });
      await expect(service.verify(input)).rejects.toThrow(/knowledge verification/);
    }
  });
});
