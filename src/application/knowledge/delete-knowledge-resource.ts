import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";

import { KnowledgeNodeNotFoundError } from "./create-knowledge-edge";
import { KnowledgeGraphAccessDeniedError } from "./create-knowledge-node";

export class KnowledgeEdgeNotFoundError extends Error {
  constructor() {
    super("knowledge edge not found");
    this.name = "KnowledgeEdgeNotFoundError";
  }
}

export function buildDeleteKnowledgeNode(repository: KnowledgeGraphRepository) {
  return async function execute(
    access: OrganizationAccess,
    nodeId: string
  ): Promise<void> {
    const node = await repository.findNodeById(access.organizationId, nodeId);
    if (!node) {
      throw new KnowledgeNodeNotFoundError();
    }
    if (!canAccessScopedResource(access, "manage", node.scope)) {
      throw new KnowledgeGraphAccessDeniedError();
    }
    if (!await repository.deleteNode(access.organizationId, nodeId, node.scope)) {
      throw new KnowledgeNodeNotFoundError();
    }
  };
}

export function buildDeleteKnowledgeEdge(repository: KnowledgeGraphRepository) {
  return async function execute(
    access: OrganizationAccess,
    edgeId: string
  ): Promise<void> {
    const edge = await repository.findEdgeById(access.organizationId, edgeId);
    if (!edge) {
      throw new KnowledgeEdgeNotFoundError();
    }
    if (!canAccessScopedResource(access, "manage", edge.scope)) {
      throw new KnowledgeGraphAccessDeniedError();
    }
    if (!await repository.deleteEdge(access.organizationId, edgeId, edge.scope)) {
      throw new KnowledgeEdgeNotFoundError();
    }
  };
}
