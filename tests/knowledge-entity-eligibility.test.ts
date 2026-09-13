import { describe, expect, it } from "vitest";
import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { assessKnowledgeCandidate } from "@/domain/knowledge/knowledge-curation-policy";
import { groundKnowledgeGraph } from "@/domain/knowledge/knowledge-extraction-quality";
import { createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { createKnowledgeOntology } from "@/domain/knowledge/knowledge-ontology";

const now = new Date("2026-09-13T00:00:00Z");
const scope = { organizationId: "org", kind: "organization" as const };
const content = "조운은 유비를 섬겼다. 제갈량은 반간지계를 사용했다. 오국태는 유비를 사위감으로 여겼다.";
const entity = (key: string, kind: string, canonicalName: string) => ({ key, kind, canonicalName, evidence: [content] });

describe("entity eligibility independent of model confidence", () => {
  it("keeps named entities and a strategy concept while excluding nominalized facts and assertion kinds", () => {
    const graph = groundKnowledgeGraph(content, {
      entities: [entity("zhao", "person", "조운"), entity("liu", "person", "유비"),
        entity("strategy", "concept", "반간지계"), entity("work", "employment", "조운"),
        entity("madeup", "concept", "조운의 유비 섬김"), entity("triple", "relationship", "유비 - 사위감 - 오국태")],
      relationships: [{ sourceKey: "zhao", targetKey: "liu", predicate: "serves", evidence: [content] },
        { sourceKey: "madeup", targetKey: "liu", predicate: "involves", evidence: [content] }]
    });
    expect(graph.entities.map((item) => item.key)).toEqual(["zhao", "liu", "strategy"]);
    expect(graph.relationships.map((item) => item.predicate)).toEqual(["serves"]);
  });

  it.each(["off", "warn", "strict"] as const)("does not revive an invalid endpoint in %s mode even when all model judgements accept it", (mode) => {
    const candidate = createKnowledgeCandidate({ id: "candidate", scope, documentId: "doc", chunkId: "chunk", model: "extractor", now,
      graph: { entities: [entity("bad", "concept", "조운의 유비 섬김"), entity("liu", "person", "유비")],
        relationships: [{ sourceKey: "bad", targetKey: "liu", predicate: "involves", evidence: [content] }] } });
    const result = assessKnowledgeCandidate({ candidate, content, model: "verifier", now,
      ontology: { mode, ontology: { nodeKinds: ["person", "concept"], edgePredicates: ["involves"] } },
      items: ["entity:bad", "entity:liu", "relationship:0"].map((item) => ({ item, support: "explicit", usefulness: "useful",
        conflict: false, evidence: content, reason: "Positive model judgement." })) });
    expect(result.items.map((item) => item.verdict)).toEqual(["ignore", "accept", "ignore"]);
  });

  it.each(["relationship", "EMPLOYMENT", " statement ", "claim", "attribute"])("rejects %s from manual node creation and ontology registration", (kind) => {
    expect(() => createKnowledgeNode({ id: "node", scope, kind, canonicalName: "조운", source: { chunkId: "chunk" }, now })).toThrow("not an assertion");
    expect(() => createKnowledgeOntology({ nodeKinds: [kind], edgePredicates: ["serves"] })).toThrow("not assertions");
  });

  it("preserves names with punctuation and multiword named events instead of using name-pattern blacklists", () => {
    const source = "C++ supports RAII. The Battle of Red Cliffs involved multiple forces.";
    const graph = groundKnowledgeGraph(source, { entities: [
      { key: "cpp", kind: "technology", canonicalName: "C++", evidence: [source] },
      { key: "battle", kind: "event", canonicalName: "Battle of Red Cliffs", evidence: [source] }
    ], relationships: [] });
    expect(graph.entities).toHaveLength(2);
  });
});
