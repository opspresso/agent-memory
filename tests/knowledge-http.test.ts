import { describe, expect, it } from "vitest";

import { createKnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import { KnowledgeOntologyViolationError } from "@/domain/knowledge/knowledge-ontology";
import { AmbiguousKnowledgeIdentityError } from "@/domain/knowledge/knowledge-alias";
import { knowledgeErrorResponse, publicKnowledgeNode } from "@/lib/knowledge-http";
import {
  createKnowledgeEdgeSchema,
  createKnowledgeNodeSchema,
  mergeKnowledgeNodesSchema
} from "@/lib/knowledge-schemas";

describe("knowledge HTTP boundary", () => {
  it("rejects assertion kinds before creating a node", () => {
    for (const kind of ["relationship", " EMPLOYMENT ", "claim"]) {
      expect(createKnowledgeNodeSchema.safeParse({ scope: { kind: "organization" }, kind, canonicalName: "조운의 유비 섬김",
        source: { chunkId: "50000000-0000-4000-8000-000000000001" } }).success).toBe(false);
    }
  });
  it("returns a conflict when a name cannot identify one existing entity", async () => {
    const response = knowledgeErrorResponse(new AmbiguousKnowledgeIdentityError([]));
    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({ error: expect.stringContaining("Multiple knowledge nodes") });
  });
  it("maps a strict ontology rejection to 422 with its violations", async () => {
    const response = knowledgeErrorResponse(
      new KnowledgeOntologyViolationError([
        { type: "unknown_predicate", term: "loves" }
      ])
    );

    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toEqual({
      error: "knowledge ontology violation",
      violations: [{ type: "unknown_predicate", term: "loves" }]
    });
  });

  it("validates scoped node and edge input", () => {
    expect(
      createKnowledgeNodeSchema.safeParse({
        scope: { kind: "organization" },
        kind: "service",
        canonicalName: "Checkout API"
      }).success
    ).toBe(false);
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
    expect(
      createKnowledgeNodeSchema.safeParse({
        scope: { kind: "organization" },
        kind: "service",
        canonicalName: "Checkout API",
        source: {
          memoryId: "30000000-0000-4000-8000-000000000001"
        }
      }).success
    ).toBe(true);
    expect(
      createKnowledgeNodeSchema.safeParse({
        scope: { kind: "organization" },
        kind: "service",
        canonicalName: "Checkout API",
        source: {
          memoryId: "30000000-0000-4000-8000-000000000001",
          chunkId: "50000000-0000-4000-8000-000000000001"
        }
      }).success
    ).toBe(false);
    expect(
      createKnowledgeNodeSchema.safeParse({
        scope: { kind: "organization" },
        kind: "service",
        canonicalName: "Checkout API",
        properties: { value: "한".repeat(11_000) },
        source: {
          memoryId: "30000000-0000-4000-8000-000000000001"
        }
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
      source: { memoryId: "30000000-0000-4000-8000-000000000009" },
      now: new Date("2026-08-26T00:00:00.000Z")
    });

    expect(publicKnowledgeNode(node)).toMatchObject({
      embeddingModel: "test-embedding"
    });
    expect(publicKnowledgeNode(node)).not.toHaveProperty("embedding");
  });

  it("requires a source node and audit reason for merge", () => {
    expect(
      mergeKnowledgeNodesSchema.safeParse({
        sourceNodeId: "60000000-0000-4000-8000-000000000010",
        reason: "Same entity"
      }).success
    ).toBe(true);
    expect(
      mergeKnowledgeNodesSchema.safeParse({
        sourceNodeId: "60000000-0000-4000-8000-000000000010",
        reason: ""
      }).success
    ).toBe(false);
  });
});
