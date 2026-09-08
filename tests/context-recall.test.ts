import { describe, expect, it } from "vitest";

import { contextRecallText } from "@/application/context/context-recall";
import type { ContextSearchResult } from "@/application/context/search-context";
import { createMemory } from "@/domain/memory/memory";

const now = new Date("2026-09-04T00:00:00.000Z");
const organizationId = "00000000-0000-0000-0000-000000000001";
const userId = "10000000-0000-0000-0000-000000000001";

function memoryResult(content: string): ContextSearchResult {
  const memory = createMemory({
    id: "30000000-0000-0000-0000-000000000001",
    kind: "decision",
    scope: { kind: "user", organizationId, userId },
    title: "Rollback decision",
    content,
    source: { type: "user" },
    createdBy: userId,
    validFrom: now,
    now
  });
  return {
    hits: [
      {
        sourceType: "memory",
        memory,
        lexicalScore: 0.4,
        vectorScore: 0.8,
        candidateScore: 0.64,
        rerankScore: 0.9,
        score: 0.9
      }
    ],
    counts: { memories: 1, documents: 0, knowledge: 0 },
    ranking: "rerank"
  };
}

describe("context recall projection", () => {
  it("formats ranked context as compact prompt text", () => {
    expect(contextRecallText(memoryResult("Use the previous release."))).toBe(
      "[memory id=30000000-0000-0000-0000-000000000001 version=1] Rollback decision\nUse the previous release."
    );
  });

  it("bounds each recalled item", () => {
    const recalled = contextRecallText(memoryResult("가".repeat(5_000)));

    expect([...recalled]).toHaveLength(1_200);
    expect(recalled.endsWith("…")).toBe(true);
  });

  it("bounds the complete recalled context", () => {
    const result = memoryResult("가".repeat(5_000));
    const recalled = contextRecallText({
      ...result,
      hits: [
        ...result.hits,
        ...result.hits,
        ...result.hits,
        ...result.hits
      ]
    });

    expect([...recalled]).toHaveLength(4_000);
    expect(recalled.endsWith("…")).toBe(true);
  });

  it("returns empty text when search has no hits", () => {
    expect(
      contextRecallText({
        hits: [],
        counts: { memories: 0, documents: 0, knowledge: 0 },
        ranking: "hybrid"
      })
    ).toBe("");
  });
});
