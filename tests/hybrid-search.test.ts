import { describe, expect, it } from "vitest";

import { combinedHybridScore } from "@/infrastructure/database/repositories/hybrid-search";

describe("hybrid search ranking policy", () => {
  it("uses one shared lexical and vector weighting policy", () => {
    expect(combinedHybridScore(1, 0)).toBeCloseTo(0.4);
    expect(combinedHybridScore(0, 1)).toBeCloseTo(0.6);
    expect(combinedHybridScore(0.5, 0.5)).toBeCloseTo(0.5);
  });
});
