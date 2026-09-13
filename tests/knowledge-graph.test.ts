import { describe, expect, it, vi } from "vitest";

import {
  buildCreateKnowledgeEdge,
  KnowledgeNodeNotFoundError
} from "@/application/knowledge/create-knowledge-edge";
import {
  buildCreateKnowledgeNode,
  KnowledgeGraphAccessDeniedError
} from "@/application/knowledge/create-knowledge-node";
import { buildGetKnowledgeNeighborhood } from "@/application/knowledge/get-knowledge-neighborhood";
import {
  buildMergeKnowledgeNodes,
  InvalidKnowledgeNodeMergeError
} from "@/application/knowledge/merge-knowledge-nodes";
import {
  buildDeleteKnowledgeEdge,
  buildDeleteKnowledgeNode,
  KnowledgeEdgeNotFoundError
} from "@/application/knowledge/delete-knowledge-resource";
import { buildSearchKnowledgeNodes } from "@/application/knowledge/search-knowledge-nodes";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import {
  createKnowledgeEdge,
  createKnowledgeNode,
  InvalidKnowledgeGraphError,
  type KnowledgeEdge,
  type KnowledgeNode
} from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";
import { KnowledgeOntologyViolationError } from "@/domain/knowledge/knowledge-ontology";
import type {
  KnowledgeOntologyReader,
  OrganizationKnowledgeOntology
} from "@/domain/knowledge/knowledge-ontology-reader";

const now = new Date("2026-08-26T00:00:00.000Z");
const access: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "member" }]
};
const evidence = { memoryId: "memory-1" };

function node(id: string, teamId = "team-1"): KnowledgeNode {
  return createKnowledgeNode({
    id,
    scope: { kind: "team", organizationId: "organization-1", teamId },
    kind: "Service",
    canonicalName: ` ${id} `,
    source: { memoryId: `${id}-memory` },
    now
  });
}

function ontologyReader(
  result: OrganizationKnowledgeOntology | null = null
): KnowledgeOntologyReader {
  return { findByOrganization: vi.fn().mockResolvedValue(result) };
}

function repository(
  overrides: Partial<KnowledgeGraphRepository> = {}
): KnowledgeGraphRepository {
  return {
    saveNode: vi.fn(),
    findNodesByNames: vi.fn(),
    findNodeById: vi.fn(),
    deleteNode: vi.fn(),
    mergeNodes: vi.fn(),
    saveEdge: vi.fn(),
    findEdgeById: vi.fn(),
    deleteEdge: vi.fn(),
    searchNodes: vi.fn(),
    findNeighborhood: vi.fn(),
    ...overrides
  };
}

describe("knowledge graph", () => {
  it("merges manageable nodes in the same scope", async () => {
    const source = node("source");
    const target = node("target");
    const mergeNodes = vi.fn().mockResolvedValue(target);
    const merge = buildMergeKnowledgeNodes({
      clock: () => now,
      repository: repository({
        findNodeById: vi
          .fn()
          .mockResolvedValueOnce(source)
          .mockResolvedValueOnce(target),
        mergeNodes
      })
    });
    const managerAccess = {
      ...access,
      teams: [{ teamId: "team-1", role: "manager" as const }]
    };

    await expect(
      merge(managerAccess, target.id, source.id, "Same entity")
    ).resolves.toBe(target);
    expect(mergeNodes).toHaveBeenCalledWith({
      organizationId: "organization-1",
      sourceNodeId: source.id,
      targetNodeId: target.id,
      mergedBy: "user-1",
      reason: "Same entity",
      now
    });
  });

  it("rejects cross-scope node merges", async () => {
    const merge = buildMergeKnowledgeNodes({
      clock: () => now,
      repository: repository({
        findNodeById: vi
          .fn()
          .mockResolvedValueOnce(node("source"))
          .mockResolvedValueOnce(node("target", "team-2"))
      })
    });
    const adminAccess: OrganizationAccess = {
      ...access,
      role: "admin",
      teams: []
    };

    await expect(
      merge(adminAccess, "target", "source", "Same name")
    ).rejects.toBeInstanceOf(InvalidKnowledgeNodeMergeError);
  });

  it("normalizes compatible kinds and canonical names", () => {
    expect(
      createKnowledgeNode({
        id: "node-1",
        scope: node("scope").scope,
        kind: " Award ",
        canonicalName: "ＡＷＳ   AI Hero",
        source: { memoryId: "memory-1" },
        now
      })
    ).toMatchObject({
      kind: "recognition",
      canonicalName: "AWS AI Hero"
    });
  });

  it("deletes a manageable node", async () => {
    const existing = node("node-1");
    const deleteNode = vi.fn().mockResolvedValue(true);
    const remove = buildDeleteKnowledgeNode(
      repository({
        findNodeById: vi.fn().mockResolvedValue(existing),
        deleteNode
      })
    );
    const managerAccess = {
      ...access,
      teams: [{ teamId: "team-1", role: "manager" as const }]
    };

    await expect(remove(managerAccess, existing.id)).resolves.toBeUndefined();
    expect(deleteNode).toHaveBeenCalledWith("organization-1", existing.id, existing.scope);
  });

  it("requires manage permission to delete a graph node", async () => {
    const deleteNode = vi.fn();
    const remove = buildDeleteKnowledgeNode(
      repository({
        findNodeById: vi.fn().mockResolvedValue(node("node-1")),
        deleteNode
      })
    );

    await expect(remove(access, "node-1")).rejects.toBeInstanceOf(
      KnowledgeGraphAccessDeniedError
    );
    expect(deleteNode).not.toHaveBeenCalled();
  });

  it("returns not found when deleting a missing edge", async () => {
    const remove = buildDeleteKnowledgeEdge(
      repository({ findEdgeById: vi.fn().mockResolvedValue(null) })
    );

    await expect(remove(access, "edge-1")).rejects.toBeInstanceOf(
      KnowledgeEdgeNotFoundError
    );
  });

  it("deletes a manageable edge", async () => {
    const existing = {
      id: "edge-1",
      organizationId: "organization-1",
      scope: node("node-1").scope,
      sourceNodeId: "node-1",
      targetNodeId: "node-2",
      predicate: "depends_on",
      properties: {},
      sources: [{ memoryId: "memory-1" }],
      createdAt: now
    } satisfies KnowledgeEdge;
    const deleteEdge = vi.fn().mockResolvedValue(true);
    const remove = buildDeleteKnowledgeEdge(
      repository({
        findEdgeById: vi.fn().mockResolvedValue(existing),
        deleteEdge
      })
    );
    const managerAccess = {
      ...access,
      teams: [{ teamId: "team-1", role: "manager" as const }]
    };

    await expect(remove(managerAccess, existing.id)).resolves.toBeUndefined();
    expect(deleteEdge).toHaveBeenCalledWith("organization-1", existing.id, existing.scope);
  });

  it("requires exactly one source reference", () => {
    expect(() =>
      createKnowledgeNode({
        id: "node-1",
        scope: node("scope").scope,
        kind: "service",
        canonicalName: "Checkout API",
        source: { memoryId: "memory-1", chunkId: "chunk-1" },
        now
      })
    ).toThrow(InvalidKnowledgeGraphError);
  });

  it("rejects self-referential edges", () => {
    expect(() =>
      createKnowledgeEdge({
        id: "edge-1",
        organizationId: "organization-1",
        scope: node("scope").scope,
        sourceNodeId: "node-1",
        targetNodeId: "node-1",
        predicate: "depends_on",
        source: { memoryId: "memory-1" },
        now
      })
    ).toThrow(InvalidKnowledgeGraphError);
  });

  it("measures knowledge properties in UTF-8 bytes", () => {
    expect(() =>
      createKnowledgeNode({
        id: "node-1",
        scope: node("scope").scope,
        kind: "service",
        canonicalName: "Checkout API",
        properties: { value: "한".repeat(11_000) },
        source: { memoryId: "memory-1" },
        now
      })
    ).toThrow("knowledge properties must not exceed 32 KiB");
  });

  it("normalizes and embeds a node before persistence", async () => {
    const saveNode = vi.fn(async (value: KnowledgeNode) => value);
    const embed = vi
      .fn()
      .mockResolvedValue({ model: "embedding-model", values: [1, 0] });
    const createNode = buildCreateKnowledgeNode({
      ontologyReader: ontologyReader(),
      authorizeSource: vi.fn(),
      clock: () => now,
      embeddingService: { embed, embedMany: vi.fn() },
      generateId: () => "node-1",
      repository: repository({ saveNode })
    });

    const result = await createNode({
      access,
      scope: {
        kind: "team",
        organizationId: "organization-1",
        teamId: "team-1"
      },
      kind: " Service ",
      canonicalName: " Checkout API ",
      summary: " Handles purchases ",
      source: evidence
    });

    expect(result.node).toMatchObject({
      kind: "service",
      canonicalName: "Checkout API",
      summary: "Handles purchases",
      embedding: { model: "embedding-model", values: [1, 0] }
    });
    expect(result.ontologyWarnings).toEqual([]);
    expect(embed).toHaveBeenCalledWith("Checkout API\nHandles purchases", {
      organizationId: access.organizationId,
      userId: access.userId
    });
  });

  it("returns ontology warnings for an unknown node kind in warn mode", async () => {
    const saveNode = vi.fn(async (value: KnowledgeNode) => value);
    const createNode = buildCreateKnowledgeNode({
      authorizeSource: vi.fn(),
      clock: () => now,
      generateId: () => "node-1",
      ontologyReader: ontologyReader({
        mode: "warn",
        ontology: { nodeKinds: ["service"], edgePredicates: [] }
      }),
      repository: repository({ saveNode })
    });

    const result = await createNode({
      access,
      scope: node("scope").scope,
      kind: "Gadget",
      canonicalName: "Checkout API",
      source: evidence
    });

    expect(result.ontologyWarnings).toEqual([
      { type: "unknown_kind", term: "gadget" }
    ]);
    expect(saveNode).toHaveBeenCalled();
  });

  it("rejects an unknown node kind in strict mode before embedding", async () => {
    const saveNode = vi.fn();
    const embed = vi.fn();
    const createNode = buildCreateKnowledgeNode({
      authorizeSource: vi.fn(),
      clock: () => now,
      embeddingService: { embed, embedMany: vi.fn() },
      generateId: () => "node-1",
      ontologyReader: ontologyReader({
        mode: "strict",
        ontology: { nodeKinds: ["service"], edgePredicates: [] }
      }),
      repository: repository({ saveNode })
    });

    await expect(
      createNode({
        access,
        scope: node("scope").scope,
        kind: "gadget",
        canonicalName: "Checkout API",
        source: evidence
      })
    ).rejects.toBeInstanceOf(KnowledgeOntologyViolationError);
    expect(embed).not.toHaveBeenCalled();
    expect(saveNode).not.toHaveBeenCalled();
  });

  it("rejects an unknown edge predicate in strict mode", async () => {
    const sourceNode = node("node-1");
    const targetNode = node("node-2");
    const saveEdge = vi.fn();
    const createEdge = buildCreateKnowledgeEdge({
      authorizeSource: vi.fn(),
      clock: () => now,
      generateId: () => "edge-1",
      ontologyReader: ontologyReader({
        mode: "strict",
        ontology: { nodeKinds: [], edgePredicates: ["depends_on"] }
      }),
      repository: repository({
        findNodeById: vi
          .fn()
          .mockResolvedValueOnce(sourceNode)
          .mockResolvedValueOnce(targetNode),
        saveEdge
      })
    });

    await expect(
      createEdge({
        access,
        scope: sourceNode.scope,
        sourceNodeId: sourceNode.id,
        targetNodeId: targetNode.id,
        predicate: "loves",
        source: evidence
      })
    ).rejects.toBeInstanceOf(KnowledgeOntologyViolationError);
    expect(saveEdge).not.toHaveBeenCalled();
  });

  it("normalizes full-width edge predicates to the ontology form", async () => {
    const sourceNode = node("node-1");
    const targetNode = node("node-2");
    const saveEdge = vi.fn(async (value: KnowledgeEdge) => value);
    const createEdge = buildCreateKnowledgeEdge({
      authorizeSource: vi.fn(),
      clock: () => now,
      generateId: () => "edge-1",
      ontologyReader: ontologyReader({
        mode: "strict",
        ontology: { nodeKinds: [], edgePredicates: ["depends_on"] }
      }),
      repository: repository({
        findNodeById: vi
          .fn()
          .mockResolvedValueOnce(sourceNode)
          .mockResolvedValueOnce(targetNode),
        saveEdge
      })
    });

    const result = await createEdge({
      access,
      scope: sourceNode.scope,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      predicate: " ＤＥＰＥＮＤＳ＿ＯＮ ",
      source: evidence
    });

    expect(result.edge.predicate).toBe("depends_on");
    expect(result.ontologyWarnings).toEqual([]);
  });

  it("rejects a node outside the caller write scope", async () => {
    const createNode = buildCreateKnowledgeNode({
      ontologyReader: ontologyReader(),
      authorizeSource: vi.fn(),
      clock: () => now,
      generateId: () => "node-1",
      repository: repository()
    });
    await expect(
      createNode({
        access,
        scope: { kind: "organization", organizationId: "organization-1" },
        kind: "service",
        canonicalName: "Checkout API",
        source: evidence
      })
    ).rejects.toBeInstanceOf(KnowledgeGraphAccessDeniedError);
  });

  it("authorizes a node source before persistence", async () => {
    const authorizeSource = vi.fn().mockResolvedValue(undefined);
    const saveNode = vi.fn(async (value: KnowledgeNode) => value);
    const createNode = buildCreateKnowledgeNode({
      ontologyReader: ontologyReader(),
      authorizeSource,
      clock: () => now,
      generateId: () => "node-1",
      repository: repository({ saveNode })
    });
    const source = { memoryId: "memory-1" };

    await createNode({
      access,
      scope: node("scope").scope,
      kind: "service",
      canonicalName: "Checkout API",
      source
    });

    expect(authorizeSource).toHaveBeenCalledWith(
      access,
      source,
      node("scope").scope
    );
    expect(saveNode).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [source] }), access
    );
  });

  it("requires both edge endpoints to be visible", async () => {
    const source = node("node-1");
    const target = node("node-2", "team-2");
    const createEdge = buildCreateKnowledgeEdge({
      ontologyReader: ontologyReader(),
      authorizeSource: vi.fn(),
      clock: () => now,
      generateId: () => "edge-1",
      repository: repository({
        findNodeById: vi
          .fn()
          .mockResolvedValueOnce(source)
          .mockResolvedValueOnce(target)
      })
    });

    await expect(
      createEdge({
        access,
        scope: source.scope,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        predicate: "depends_on",
        source: evidence
      })
    ).rejects.toBeInstanceOf(KnowledgeNodeNotFoundError);
  });

  it("authorizes an edge source before persistence", async () => {
    const sourceNode = node("node-1");
    const targetNode = node("node-2");
    const source = { chunkId: "chunk-1" };
    const authorizeSource = vi.fn().mockResolvedValue(undefined);
    const saveEdge = vi.fn(async (value: KnowledgeEdge) => value);
    const createEdge = buildCreateKnowledgeEdge({
      ontologyReader: ontologyReader(),
      authorizeSource,
      clock: () => now,
      generateId: () => "edge-1",
      repository: repository({
        findNodeById: vi
          .fn()
          .mockResolvedValueOnce(sourceNode)
          .mockResolvedValueOnce(targetNode),
        saveEdge
      })
    });

    await createEdge({
      access,
      scope: sourceNode.scope,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      predicate: "depends_on",
      source
    });

    expect(authorizeSource).toHaveBeenCalledWith(
      access,
      source,
      sourceNode.scope
    );
    expect(saveEdge).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [source] })
    );
  });

  it("filters inaccessible nodes and dangling edges from a neighborhood", async () => {
    const root = node("node-1");
    const visible = node("node-2");
    const hidden = node("node-3", "team-2");
    const getNeighborhood = buildGetKnowledgeNeighborhood(
      repository({
        findNodeById: vi.fn().mockResolvedValue(root),
        findNeighborhood: vi.fn().mockResolvedValue({
          nodes: [root, visible, hidden],
          edges: [
            {
              id: "edge-1",
              organizationId: "organization-1",
              scope: root.scope,
              sourceNodeId: root.id,
              targetNodeId: visible.id,
              predicate: "depends_on",
              properties: {},
              sources: [],
              createdAt: now
            },
            {
              id: "edge-2",
              organizationId: "organization-1",
              scope: root.scope,
              sourceNodeId: root.id,
              targetNodeId: hidden.id,
              predicate: "depends_on",
              properties: {},
              sources: [],
              createdAt: now
            }
          ]
        })
      })
    );

    await expect(getNeighborhood(access, root.id)).resolves.toEqual({
      nodes: [root, visible],
      edges: [expect.objectContaining({ id: "edge-1" })]
    });
  });

  it("filters search results defensively", async () => {
    const visible = node("node-1");
    const hidden = node("node-2", "team-2");
    const searchNodes = buildSearchKnowledgeNodes({
      repository: repository({
        searchNodes: vi.fn().mockResolvedValue([
          { node: visible, lexicalScore: 1, vectorScore: 0, score: 1 },
          { node: hidden, lexicalScore: 1, vectorScore: 0, score: 1 }
        ])
      })
    });

    await expect(searchNodes(access, "checkout")).resolves.toEqual([
      expect.objectContaining({ node: visible })
    ]);
  });
});
