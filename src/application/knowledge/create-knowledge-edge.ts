import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
import {
  createKnowledgeEdge,
  type KnowledgeEdge,
  type KnowledgeSource
} from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";

import { KnowledgeGraphAccessDeniedError } from "./create-knowledge-node";

export interface CreateKnowledgeEdgeInput {
  readonly access: OrganizationAccess;
  readonly scope: ScopedResource;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly predicate: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly source?: KnowledgeSource;
}

export interface CreateKnowledgeEdgeDependencies {
  readonly clock: () => Date;
  readonly generateId: () => string;
  readonly repository: KnowledgeGraphRepository;
}

export class KnowledgeNodeNotFoundError extends Error {
  constructor() {
    super("knowledge node not found");
    this.name = "KnowledgeNodeNotFoundError";
  }
}

export function buildCreateKnowledgeEdge(
  dependencies: CreateKnowledgeEdgeDependencies
) {
  return async function execute(
    input: CreateKnowledgeEdgeInput
  ): Promise<KnowledgeEdge> {
    if (!canAccessScopedResource(input.access, "write", input.scope)) {
      throw new KnowledgeGraphAccessDeniedError();
    }

    const [sourceNode, targetNode] = await Promise.all([
      dependencies.repository.findNodeById(
        input.access.organizationId,
        input.sourceNodeId
      ),
      dependencies.repository.findNodeById(
        input.access.organizationId,
        input.targetNodeId
      )
    ]);
    if (
      !sourceNode ||
      !targetNode ||
      !canAccessScopedResource(input.access, "read", sourceNode.scope) ||
      !canAccessScopedResource(input.access, "read", targetNode.scope)
    ) {
      throw new KnowledgeNodeNotFoundError();
    }

    return dependencies.repository.saveEdge(
      createKnowledgeEdge({
        id: dependencies.generateId(),
        organizationId: input.access.organizationId,
        scope: input.scope,
        sourceNodeId: sourceNode.id,
        targetNodeId: targetNode.id,
        predicate: input.predicate,
        ...(input.properties ? { properties: input.properties } : {}),
        ...(input.source ? { source: input.source } : {}),
        now: dependencies.clock()
      })
    );
  };
}
