import { describe, expect, it } from "vitest";

import {
  contextResultPresentation,
  relativeRelevance
} from "@/app/context-result-presentation";
import { translator } from "@/app/_i18n/translate";

const t = translator("ko");

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
      }, t)
    ).toEqual({
      sourceType: "document",
      sourceLabel: "Document",
      scopeLabel: "팀",
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
      }, t).evidenceLabel
    ).toBe("문서 근거에서 연결된 지식");
  });

  it("infers the source type for dedicated search endpoints", () => {
    expect(
      contextResultPresentation({ document: { scope: { kind: "user" } } }, t)
        .sourceType
    ).toBe("document");
    expect(
      contextResultPresentation({ node: { scope: { kind: "team" } } }, t)
        .sourceType
    ).toBe("knowledge");
  });

  it("normalizes relevance against the strongest result", () => {
    expect(relativeRelevance(0.45, 0.9)).toBe(50);
    expect(relativeRelevance(2, 1)).toBe(100);
    expect(relativeRelevance(undefined, 1)).toBe(0);
  });

  it("localizes sharing scope without assuming unknown data is organization-wide", () => {
    expect(contextResultPresentation({ memory: { scope: { kind: "user" } } }, t).scopeLabel).toBe("개인");
    expect(contextResultPresentation({ memory: { scope: { kind: "organization" } } }, translator("en")).scopeLabel).toBe("Organization");
    expect(contextResultPresentation({ memory: {} }, t).scopeLabel).toBe("범위 확인 필요");
  });
});
