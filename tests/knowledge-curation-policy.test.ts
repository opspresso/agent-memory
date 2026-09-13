import { describe, expect, it } from "vitest";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { assessKnowledgeCandidate } from "@/domain/knowledge/knowledge-curation-policy";
import type { KnowledgeItemVerification } from "@/domain/knowledge/knowledge-assessment";
import { createKnowledgeEdge } from "@/domain/knowledge/knowledge-graph";

const content = "유비는 노식의 제자다.";
const candidate = createKnowledgeCandidate({ id: "c", scope: { organizationId: "org", kind: "organization" }, documentId: "d", chunkId: "ch", model: "extractor", now: new Date(),
  graph: { entities: [{ key: "liu", kind: "person", canonicalName: "유비" }, { key: "lu", kind: "person", canonicalName: "노식" }],
    relationships: [{ sourceKey: "liu", targetKey: "lu", predicate: "student_of" }] } });
const items: readonly KnowledgeItemVerification[] = ["entity:liu", "entity:lu", "relationship:0"].map((item) => ({
  item, representation: item.startsWith("entity:") ? "entity" : "relationship", entityKind: "person", support: "explicit", usefulness: "useful", conflict: false, evidence: content, reason: "원문에 명시된 사제 관계다."
}));
function assess(changes: Partial<KnowledgeItemVerification> = {}) {
  return assessKnowledgeCandidate({ candidate, content, model: "verifier", now: new Date(), ontology: null,
    items: items.map((item) => item.item === "relationship:0" ? { ...item, ...changes } : item) });
}
describe("automatic knowledge curation policy", () => {
  it("rejects a true relation sentence used as a concept even when that exact name appears in the source", () => {
    const source = "조운의 유비 섬김은 두 사람의 관계를 설명하는 문장이다. 유비가 등장한다.";
    const proposed = { ...candidate,graph:{ entities:[{ key:"statement",kind:"concept",canonicalName:"조운의 유비 섬김" },{ key:"liu",kind:"person",canonicalName:"유비" }],
      relationships:[{ sourceKey:"statement",targetKey:"liu",predicate:"involves" }] } };
    const results: readonly KnowledgeItemVerification[] = ["entity:statement","entity:liu","relationship:0"].map((item) => ({ item,
      representation:item === "entity:liu"?"entity":"relationship",entityKind:item === "entity:liu"?"person":"concept",support:"explicit",usefulness:"useful",conflict:false,evidence:source,reason:"The words occur in the source." }));
    const result = assessKnowledgeCandidate({ candidate:proposed,content:source,model:"verifier",items:results,ontology:null,now:new Date() });
    expect(result.items.map((item) => item.verdict)).toEqual(["ignore","accept","ignore"]);
    expect(result.policyVersion).toBe("evidence-v3");
    expect(result.items[0]?.representation).toBe("relationship");
  });
  it("does not let a positive relation revive an endpoint whose entity representation is uncertain", () => {
    const result = assessKnowledgeCandidate({ candidate,content,model:"verifier",now:new Date(),ontology:null,
      items:items.map((item) => item.item === "entity:liu"?{ ...item,representation:"uncertain" }:item) });
    expect(result.items[0]?.verdict).toBe("review");
    expect(result.items[2]?.verdict).toBe("review");
  });
  it("requires independent agreement on entity kind even when support and usefulness are positive", () => {
    const result = assessKnowledgeCandidate({ candidate,content,model:"verifier",now:new Date(),ontology:null,
      items:items.map((item) => item.item === "entity:liu"?{ ...item,entityKind:"organization" }:item) });
    expect(result.items[0]).toMatchObject({ verdict:"review",entityKind:"organization" });
    expect(result.items[2]?.verdict).toBe("review");
  });
  it("does not promote a scene's departure location as a durable origin relationship", () => {
    const movement = { ...candidate, graph: { ...candidate.graph, relationships: [{ sourceKey: "liu", targetKey: "lu", predicate: "comes_from" }] } };
    const result = assessKnowledgeCandidate({ candidate: movement, content, model: "verifier", now: new Date(), ontology: null, items });
    expect(result.items.find((item) => item.item === "relationship:0")?.verdict).toBe("ignore");
  });
  it("canonicalizes symmetric edge endpoints but preserves directed relations", () => {
    const input = { id: "edge", organizationId: "org", scope: { organizationId: "org", kind: "organization" as const },
      sourceNodeId: "b", targetNodeId: "a", predicate: "sworn_sibling_of", source: { chunkId: "chunk" }, now: new Date() };
    expect(createKnowledgeEdge(input)).toMatchObject({ sourceNodeId: "a", targetNodeId: "b" });
    expect(createKnowledgeEdge({ ...input, predicate: "student_of" })).toMatchObject({ sourceNodeId: "b", targetNodeId: "a" });
  });
  it("accepts explicit useful facts only when quoted source evidence exists", () => {
    expect(assess().items.map((item) => item.verdict)).toEqual(["accept", "accept", "accept"]);
    expect(assess({ evidence: "invented quotation" }).items[2]).toMatchObject({ verdict: "review", evidence: "" });
  });
  it.each([
    [{ support: "uncertain" }, "review"],
    [{ conflict: true }, "review"],
    [{ support: "unsupported" }, "ignore"],
    [{ usefulness: "incidental" }, "ignore"]
  ] as const)("routes uncertainty, contradictions and low utility deterministically", (changes, verdict) => {
    expect(assess(changes).items[2]?.verdict).toBe(verdict);
  });
  it("never auto-accepts a relation with an uncertain endpoint", () => {
    const result = assessKnowledgeCandidate({ candidate, content, model: "verifier", now: new Date(), ontology: null,
      items: items.map((item) => item.item === "entity:liu" ? { ...item, support: "uncertain" } : item) });
    expect(result.items[2]?.verdict).toBe("review");
  });
  it("accepts only independently grounded aliases while retaining facts with a rejected title", () => {
    const source = `${content} 유비의 자는 현덕이며 장군으로 불렸다.`;
    const aliased = { ...candidate, graph: { ...candidate.graph, entities: candidate.graph.entities.map((entity, index) => index === 0 ? { ...entity, aliases: ["현덕", "장군"] } : entity) } };
    const result = assessKnowledgeCandidate({ candidate: aliased, content: source, model: "verifier", now: new Date(), ontology: null,
      items: items.map((item) => ({ ...item, evidence: source })), aliases: [
        { entityKey: "liu", alias: "현덕", identity: "same_entity", evidence: "유비의 자는 현덕이며 장군으로 불렸다.", reason: "Explicit courtesy name." },
        { entityKey: "liu", alias: "장군", identity: "generic_reference", evidence: "유비의 자는 현덕이며 장군으로 불렸다.", reason: "Shared title." }
      ] });
    expect(result.aliases?.map((alias) => [alias.alias, alias.verdict])).toEqual([["현덕", "accept"], ["장군", "ignore"]]);
    expect(result.items.every((item) => item.verdict === "accept")).toBe(true);
  });
  it("keeps unverified or ungrounded alias identity and its relationships for review", () => {
    const aliased = { ...candidate, graph: { ...candidate.graph, entities: candidate.graph.entities.map((entity, index) => index === 0 ? { ...entity, aliases: ["현덕"] } : entity) } };
    for (const aliases of [undefined, [{ entityKey: "liu", alias: "현덕", identity: "same_entity" as const, evidence: "Invented identity quote.", reason: "Invalid citation." }]]) {
      const result = assessKnowledgeCandidate({ candidate: aliased, content, model: "verifier", now: new Date(), ontology: null, items, aliases });
      expect(result.aliases?.[0]?.verdict).toBe("review");
      expect(result.items[0]?.verdict).toBe("review");
      expect(result.items[2]?.verdict).toBe("review");
    }
  });
  it("requires complete, unique item coverage before any automatic action", () => {
    for (const invalid of [items.slice(1), [...items, items[0]!], items.map((item) => ({ ...item, item: "unknown" }))]) {
      expect(() => assessKnowledgeCandidate({ candidate, content, model: "verifier", now: new Date(), ontology: null, items: invalid })).toThrow("exactly once");
    }
  });
  it("preserves strict ontology violations for human review", () => {
    const result = assessKnowledgeCandidate({ candidate, content, model: "verifier", now: new Date(), items,
      ontology: { mode: "strict", ontology: { nodeKinds: ["person"], edgePredicates: ["parent_of"] } } });
    expect(result.items[2]?.verdict).toBe("review");
  });
  it("keeps incidental endpoints needed by an important relation", () => {
    const result = assessKnowledgeCandidate({ candidate, content, model: "verifier", now: new Date(), ontology: null,
      items: items.map((item) => item.item.startsWith("entity:") ? { ...item, usefulness: "incidental" } : item) });
    expect(result.items.every((item) => item.verdict === "accept")).toBe(true);
  });
  it("never creates separate alias identities automatically", () => {
    const aliased = { ...candidate, graph: { ...candidate.graph,
      relationships: [{ sourceKey: "liu", targetKey: "lu", predicate: "alias_of" }] } };
    const result = assessKnowledgeCandidate({ candidate: aliased, content, model: "verifier", now: new Date(), ontology: null, items });
    expect(result.items.every((item) => item.verdict === "review")).toBe(true);
  });
});
