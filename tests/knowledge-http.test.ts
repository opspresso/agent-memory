import { describe, expect, it } from "vitest";

import { createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { publicKnowledgeNode } from "@/lib/knowledge-http";
import {
  createKnowledgeEdgeSchema,
  createKnowledgeNodeSchema
} from "@/lib/knowledge-schemas";

describe("knowledge HTTP boundary", () => {
  it("validates scoped node and edge input", () => {
    expect(
      createKnowledgeNodeSchema.safeParse({
        scope: { kind: "team" },
        kind: "service",
        canonicalName: "Checkout API"
      }).success
    ).toBe(false);
    expect(
      createKnowledgeEdgeSchema.safeParse({
        scope: { kind: "organization" },
        sourceNodeId: "not-a-uuid",
        targetNodeId: "60000000-0000-0000-0000-000000000010",
        predicate: "depends_on"
      }).success
    ).toBe(false);
  });

  it("does not expose raw embedding vectors", () => {
    const node = createKnowledgeNode({
      id: "60000000-0000-0000-0000-000000000009",
      scope: {
        kind: "organization",
        organizationId: "00000000-0000-0000-0000-000000000009"
      },
      kind: "service",
      canonicalName: "Checkout API",
      embedding: { model: "test-embedding", values: [1, 0, 0] },
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(publicKnowledgeNode(node)).toMatchObject({
      embeddingModel: "test-embedding"
    });
    expect(publicKnowledgeNode(node)).not.toHaveProperty("embedding");
  });
});
