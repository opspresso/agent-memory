import { describe, expect, it } from "vitest";
import { mergeKnowledgeProperties } from "@/domain/knowledge/knowledge-properties";

describe("knowledge property contributions", () => {
  it("prefers newer visible values and restores older values when the newer source is omitted", () => {
    const older = { chunkId: "older", properties: { retained: true, shared: "older" }, updatedAt: new Date(1) };
    const newer = { memoryId: "newer", properties: { private: true, shared: "newer" }, updatedAt: new Date(2) };
    expect(mergeKnowledgeProperties([newer, older])).toEqual({ retained: true, private: true, shared: "newer" });
    expect(mergeKnowledgeProperties([older])).toEqual({ retained: true, shared: "older" });
  });

  it("breaks equal timestamp ties by source type and identifier regardless of row order", () => {
    const updatedAt = new Date(1);
    const rows = [
      { chunkId: "a", properties: { shared: "chunk a" }, updatedAt },
      { chunkId: "b", properties: { shared: "chunk b" }, updatedAt },
      { memoryId: "a", properties: { shared: "memory a" }, updatedAt }
    ];
    expect(mergeKnowledgeProperties(rows)).toEqual({ shared: "memory a" });
    expect(mergeKnowledgeProperties(rows.toReversed())).toEqual({ shared: "memory a" });
    expect(mergeKnowledgeProperties(rows.slice(0, 2).toReversed())).toEqual({ shared: "chunk b" });
  });

  it("preserves arbitrary JSON keys without modifying the result prototype", () => {
    const properties = JSON.parse('{"__proto__":{"injected":true},"constructor":"ordinary value"}') as Record<string, unknown>;
    const merged = mergeKnowledgeProperties([{ memoryId: "source", properties, updatedAt: new Date(1) }]);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(merged.constructor).toBe("ordinary value");
    expect(merged.injected).toBeUndefined();
  });
});
