import { describe, expect, it } from "vitest";

import {
  contextResultPresentation,
  relativeRelevance
} from "@/app/context-result-presentation";

describe("context result presentation", () => {
  it("describes document chunk provenance", () => {
    expect(
      contextResultPresentation({
        sourceType: "document",
        document: {
          mimeType: "text/markdown",
          scope: { kind: "team" }
        },
        chunk: { ordinal: 2 },
        lexicalScore: 0.6,
        vectorScore: 0.3,
        score: 0.9
      })
    ).toEqual({
      sourceType: "document",
      sourceLabel: "Document",
      scopeLabel: "team",
      evidenceLabel: "text/markdown · chunk 3",
      lexicalScore: 0.6,
      vectorScore: 0.3,
      score: 0.9
    });
  });

  it("identifies the evidence behind graph knowledge", () => {
    expect(
      contextResultPresentation({
        node: {
          scope: { kind: "organization" },
          sources: [{ chunkId: "chunk-id" }]
        }
      }).evidenceLabel
    ).toBe("문서 근거에서 연결된 지식");
  });

  it("infers the source type for dedicated search endpoints", () => {
    expect(
      contextResultPresentation({ document: { scope: { kind: "user" } } })
        .sourceType
    ).toBe("document");
    expect(
      contextResultPresentation({ node: { scope: { kind: "team" } } })
        .sourceType
    ).toBe("knowledge");
  });

  it("normalizes relevance against the strongest result", () => {
    expect(relativeRelevance(0.45, 0.9)).toBe(50);
    expect(relativeRelevance(2, 1)).toBe(100);
    expect(relativeRelevance(undefined, 1)).toBe(0);
  });
});
