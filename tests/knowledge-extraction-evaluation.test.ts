import { describe, expect, it } from "vitest";
import { extractionMetrics, scoreKnowledgeExtraction } from "@/domain/knowledge/knowledge-extraction-evaluation";

const entities = [{ key:"a",kind:"person",canonicalName:"조운" },{ key:"b",kind:"person",canonicalName:"유비" }];
const expected = { entities:[{ kind:"person",name:"조운" },{ kind:"person",name:"유비" }],
  relationships:[{ source:"조운",predicate:"serves",target:"유비" }] };
describe("knowledge extraction evaluation", () => {
  it("reports annotated surface equivalence separately from canonical naming and never guesses equivalents", () => {
    const expected = { entities:[{ kind:"service",name:"Atlas" }],relationships:[],surfaceForms:{ Atlas:["Atlas 서비스"] } };
    const graph = { entities:[{ key:"a",kind:"service",canonicalName:"Atlas 서비스" }],relationships:[] };
    expect(scoreKnowledgeExtraction(graph,expected).entities.falsePositive).toBe(1);
    expect(scoreKnowledgeExtraction(graph,expected,true).entities.truePositive).toBe(1);
    expect(scoreKnowledgeExtraction({ ...graph,entities:[{ ...graph.entities[0]!,canonicalName:"Atlas 제품" }] },expected,true).entities.falsePositive).toBe(1);
  });
  it("penalizes reversed relations, extra entities and duplicates rather than scoring only recall", () => {
    const score = scoreKnowledgeExtraction({ entities:[...entities,{ ...entities[0]!,key:"duplicate" },{ key:"bad",kind:"concept",canonicalName:"조운의 유비 섬김" }],
      relationships:[{ sourceKey:"b",predicate:"serves",targetKey:"a" }] },expected);
    expect(score.entities).toEqual({ truePositive:2,falsePositive:2,falseNegative:0 });
    expect(score.relationships).toEqual({ truePositive:0,falsePositive:1,falseNegative:1 });
    expect(extractionMetrics(score.entities)).toMatchObject({ precision:0.5,recall:1 });
  });
  it("resolves unambiguous gold aliases without merging different people sharing a nickname", () => {
    const people = { entities:[{ kind:"person",name:"Alice" },{ kind:"person",name:"Bob" }],relationships:[],aliases:{ Alice:["Sam"],Bob:["Sam"] } };
    expect(scoreKnowledgeExtraction({ entities:[{ key:"s",kind:"person",canonicalName:"Sam" }],relationships:[] },people).entities)
      .toEqual({ truePositive:0,falsePositive:1,falseNegative:2 });
    const merged = scoreKnowledgeExtraction({ entities:[{ key:"a",kind:"person",canonicalName:"Alice",aliases:["Bob"] }],relationships:[] },people);
    expect(merged.falseMerges).toBe(1);
    expect(merged.aliases.falsePositive).toBe(1);
  });
  it("treats symmetric relation directions as equivalent and scores unexpected titles as false aliases", () => {
    const score = scoreKnowledgeExtraction({ entities:[{ ...entities[0]!,aliases:["장군"] },entities[1]!],relationships:[{ sourceKey:"b",predicate:"sworn_sibling_of",targetKey:"a" }] },
      { ...expected,relationships:[{ source:"조운",predicate:"sworn_sibling_of",target:"유비" }] });
    expect(score.relationships).toEqual({ truePositive:1,falsePositive:0,falseNegative:0 });
    expect(score.aliases.falsePositive).toBe(1);
  });
});
