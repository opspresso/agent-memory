import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type {
  KnowledgeGraphRepository,
  KnowledgeNeighborhood
} from "@/domain/knowledge/knowledge-graph-repository";

import {
  KnowledgeNodeNotFoundError
} from "./create-knowledge-edge";
import { InvalidKnowledgeSearchError } from "./search-knowledge-nodes";

export function buildGetKnowledgeNeighborhood(
  repository: KnowledgeGraphRepository
) {
  return async function execute(
    access: OrganizationAccess,
    nodeId: string,
    depth = 1,
    limit = 100
  ): Promise<KnowledgeNeighborhood> {
    if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
      throw new InvalidKnowledgeSearchError(
        "knowledge traversal depth must be between 1 and 5"
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new InvalidKnowledgeSearchError(
        "knowledge traversal limit must be between 1 and 200"
      );
    }

    const root = await repository.findNodeById(access.organizationId, nodeId);
    if (!root || !canAccessScopedResource(access, "read", root.scope)) {
      throw new KnowledgeNodeNotFoundError();
    }

    const neighborhood = await repository.findNeighborhood(
      access,
      nodeId,
      depth,
      limit
    );
    const nodes = neighborhood.nodes.filter((node) =>
      canAccessScopedResource(access, "read", node.scope)
    );
    const nodeIds = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: neighborhood.edges.filter(
        (edge) =>
          canAccessScopedResource(access, "read", edge.scope) &&
          nodeIds.has(edge.sourceNodeId) &&
          nodeIds.has(edge.targetNodeId)
      )
    };
  };
}
