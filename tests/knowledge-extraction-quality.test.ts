import { describe, expect, it } from "vitest";

import { createKnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import { consolidateKnowledgeGraph, groundKnowledgeGraph } from "@/domain/knowledge/knowledge-extraction-quality";

const entities = [
  { key: "liu", kind: "person", canonicalName: "유비", aliases: ["현덕"], evidence: ["유비는 노식의 제자다."] },
  { key: "lu", kind: "person", canonicalName: "노식", evidence: ["유비는 노식의 제자다."] }
];

describe("knowledge extraction quality", () => {
  it("preserves a specific grounded relation and excludes invented evidence and vague relations", () => {
    const graph = groundKnowledgeGraph("유비는\n노식의 제자다.", {
      entities: [...entities, { key: "cao", kind: "person", canonicalName: "조조", evidence: ["조조가 말했다."] }],
      relationships: [
        { sourceKey: "liu", targetKey: "lu", predicate: "student_of", evidence: ["유비는 노식의 제자다."] },
        { sourceKey: "liu", targetKey: "lu", predicate: "associated_with", evidence: ["유비는 노식의 제자다."] },
        { sourceKey: "liu", targetKey: "lu", predicate: "killed", evidence: ["유비가 노식을 죽였다."] },
        { sourceKey: "cao", targetKey: "lu", predicate: "student_of", evidence: ["유비는 노식의 제자다."] }
      ]
    });
    expect(graph.entities.map((entity) => entity.canonicalName)).toEqual(["유비", "노식"]);
    expect(graph.relationships.map((relation) => relation.predicate)).toEqual(["student_of"]);
    expect(graph.entities[0]?.aliases).toEqual(["현덕"]);
  });

  it("retains entity-only knowledge but returns empty arrays without any grounded entities", () => {
    expect(groundKnowledgeGraph("유비는 노식의 제자다.", { entities, relationships: [] }).entities).toHaveLength(2);
    expect(groundKnowledgeGraph("목차", { entities, relationships: [] })).toEqual({ entities: [], relationships: [] });
  });

  it("merges exact identities, remaps endpoints and unions symmetric relation evidence", () => {
    const graph = consolidateKnowledgeGraph({
      entities: [
        ...entities,
        { key: "liu2", kind: "PERSON", canonicalName: " 유비 ", summary: "Another supported fact", evidence: ["second passage"] },
        { key: "place", kind: "location", canonicalName: "유비" }
      ],
      relationships: [
        { sourceKey: "liu", targetKey: "lu", predicate: "sworn_sibling_of", evidence: ["first passage"] },
        { sourceKey: "lu", targetKey: "liu2", predicate: "sworn_sibling_of", evidence: ["second passage"] },
        { sourceKey: "liu2", targetKey: "liu", predicate: "related_to" },
        { sourceKey: "liu", targetKey: "lu", predicate: "student_of" },
        { sourceKey: "lu", targetKey: "liu", predicate: "student_of" }
      ]
    });
    expect(graph.entities).toHaveLength(3);
    expect(graph.relationships).toHaveLength(3);
    expect(graph.relationships[0]?.evidence).toEqual(["first passage", "second passage"]);
    expect(graph.relationships.some((relation) => relation.sourceKey === relation.targetKey)).toBe(false);
  });

  it("never fuzzy-merges aliases or differently typed identities", () => {
    const graph = consolidateKnowledgeGraph({ entities: [...entities, { key: "alias", kind: "person", canonicalName: "현덕" }], relationships: [] });
    expect(graph.entities).toHaveLength(3);
  });

  it("preserves immutable evidence and aliases through candidate construction", () => {
    const candidate = createKnowledgeCandidate({
      id: "candidate", scope: { organizationId: "org", kind: "organization" },
      documentId: "document", chunkId: "chunk", model: "test", now: new Date(),
      graph: { entities, relationships: [] }
    });
    expect(candidate.graph.entities[0]?.aliases).toEqual(["현덕"]);
    expect(candidate.graph.entities[0]?.evidence).toEqual(["유비는 노식의 제자다."]);
    expect(Object.isFrozen(candidate.graph.entities[0]?.evidence)).toBe(true);
  });
});
