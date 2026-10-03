import { describe, expect, it } from "vitest";
import { createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { knowledgeAliases, knowledgeDisplayIdentity, resolveKnowledgeIdentity } from "@/domain/knowledge/knowledge-alias";

const node = (id: string, canonicalName: string, aliases: string[] = [], kind = "person") => ({ ...createKnowledgeNode({
  id, canonicalName, aliases, kind, scope: { kind: "organization", organizationId: "org" }, source: { chunkId: id }, now: new Date("2026-01-01")
}), primaryNames: [canonicalName] });

describe("verified knowledge identity", () => {
  it("uses only visible names with a deterministic representative and alias order", () => {
    const names = ["Beta", "Public Alias", "PUBLIC ALIAS", "Alpha"];
    expect(knowledgeDisplayIdentity("Hidden", names)).toEqual({ canonicalName: "Alpha", aliases: ["Beta", "Public Alias"] });
    expect(knowledgeDisplayIdentity("Hidden", names.toReversed())).toEqual(knowledgeDisplayIdentity("Hidden", names));
    expect(knowledgeDisplayIdentity("PUBLIC ALIAS", names)).toEqual({ canonicalName: "Public Alias", aliases: ["Alpha", "Beta"] });
  });

  it("does not fall back to a stored name without supporting source names", () => {
    expect(() => knowledgeDisplayIdentity("Hidden", [])).toThrow("no source names");
  });

  it("does not treat a display alias as evidence of an original representative name", () => {
    const existing = ["Visible1", "Visible2"].map((name, index) => ({
      ...node(String(index), `Hidden${index}`),
      ...knowledgeDisplayIdentity(`Hidden${index}`, [name, "Alias"]),
      primaryNames: [name]
    }));
    expect(existing.map((value) => value.canonicalName)).toEqual(["Alias", "Alias"]);
    expect(resolveKnowledgeIdentity({ canonicalName: "NewPerson", aliases: ["Alias"], kind: "person" }, existing))
      .toEqual({ status: "new" });
  });

  it("normalizes names without fuzzy matching or losing their spelling", () => {
    expect(knowledgeAliases("제갈량", [" 제갈량 ", "공명", " 공명 ", "Ｚｈｕｇｅ  Liang", "zhuge liang"]))
      .toEqual(["공명", "zhuge liang"]);
    expect(resolveKnowledgeIdentity({ canonicalName: "제갈양", aliases: [], kind: "person" }, [node("a", "제갈량", ["공명"])]))
      .toEqual({ status: "new" });
  });
  it("reuses one ID when a later passage uses a verified alias", () => {
    expect(resolveKnowledgeIdentity({ canonicalName: "공명", aliases: [], kind: "person" }, [node("a", "제갈량", ["공명", "제갈공명"])]))
      .toMatchObject({ status: "resolved", target: { id: "a" }, mergeNodeIds: [] });
  });
  it("joins individually unambiguous names only when the proposal establishes their aliases", () => {
    const existing = [node("a", "제갈량"), node("b", "공명"), node("c", "제갈공명")];
    expect(resolveKnowledgeIdentity({ canonicalName: "제갈량", aliases: ["공명", "제갈공명"], kind: "person" }, existing))
      .toMatchObject({ status: "resolved", target: { id: "a" }, mergeNodeIds: ["b", "c"] });
    expect(resolveKnowledgeIdentity({ canonicalName: "공명", aliases: [], kind: "person" }, existing))
      .toMatchObject({ status: "resolved", target: { id: "b" }, mergeNodeIds: [] });
  });
  it("does not guess between shared aliases or conflate different entity kinds", () => {
    expect(resolveKnowledgeIdentity({ canonicalName: "Sam", aliases: [], kind: "person" }, [node("a", "Alice", ["Sam"]), node("b", "Bob", ["Sam"])]))
      .toEqual({ status: "ambiguous" });
    expect(resolveKnowledgeIdentity({ canonicalName: "Sam", aliases: [], kind: "location" }, [node("a", "Alice", ["Sam"])]))
      .toEqual({ status: "new" });
  });
  it("does not merge distinct representative names merely because they share a nickname", () => {
    expect(resolveKnowledgeIdentity({ canonicalName: "Bob", aliases: ["Sam"], kind: "person" }, [node("a", "Alice", ["Sam"])]))
      .toEqual({ status: "new" });
    expect(resolveKnowledgeIdentity({ canonicalName: "제갈량", aliases: ["공명"], kind: "person" }, [node("a", "제갈량", ["공명"]), node("b", "공명")]))
      .toMatchObject({ status: "resolved", target: { id: "a" }, mergeNodeIds: ["b"] });
  });
});
