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
import { buildSearchKnowledgeNodes } from "@/application/knowledge/search-knowledge-nodes";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import {
  createKnowledgeNode,
  type KnowledgeNode
} from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";

const now = new Date("2026-08-26T00:00:00.000Z");
const access: OrganizationAccess = {
  organizationId: "organization-1",
  userId: "user-1",
  role: "member",
  teams: [{ teamId: "team-1", role: "member" }]
};

function node(id: string, teamId = "team-1"): KnowledgeNode {
  return createKnowledgeNode({
    id,
    scope: { kind: "team", organizationId: "organization-1", teamId },
    kind: "Service",
    canonicalName: ` ${id} `,
    now
  });
}

function repository(
  overrides: Partial<KnowledgeGraphRepository> = {}
): KnowledgeGraphRepository {
  return {
    saveNode: vi.fn(),
    findNodeById: vi.fn(),
    saveEdge: vi.fn(),
    searchNodes: vi.fn(),
    findNeighborhood: vi.fn(),
    ...overrides
  };
}

describe("knowledge graph", () => {
  it("normalizes and embeds a node before persistence", async () => {
    const saveNode = vi.fn(async (value: KnowledgeNode) => value);
    const embed = vi
      .fn()
      .mockResolvedValue({ model: "embedding-model", values: [1, 0] });
    const createNode = buildCreateKnowledgeNode({
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
      summary: " Handles purchases "
    });

    expect(result).toMatchObject({
      kind: "service",
      canonicalName: "Checkout API",
      summary: "Handles purchases",
      embedding: { model: "embedding-model", values: [1, 0] }
    });
    expect(embed).toHaveBeenCalledWith("Checkout API\nHandles purchases");
  });

  it("rejects a node outside the caller write scope", async () => {
    const createNode = buildCreateKnowledgeNode({
      clock: () => now,
      generateId: () => "node-1",
      repository: repository()
    });
    await expect(
      createNode({
        access,
        scope: { kind: "organization", organizationId: "organization-1" },
        kind: "service",
        canonicalName: "Checkout API"
      })
    ).rejects.toBeInstanceOf(KnowledgeGraphAccessDeniedError);
  });

  it("requires both edge endpoints to be visible", async () => {
    const source = node("node-1");
    const target = node("node-2", "team-2");
    const createEdge = buildCreateKnowledgeEdge({
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
        predicate: "depends_on"
      })
    ).rejects.toBeInstanceOf(KnowledgeNodeNotFoundError);
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
              source: {},
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
              source: {},
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
