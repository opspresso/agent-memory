import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
import type { KnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";

import { KnowledgeNodeNotFoundError } from "./create-knowledge-edge";
import { KnowledgeGraphAccessDeniedError } from "./create-knowledge-node";

export class InvalidKnowledgeNodeMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledgeNodeMergeError";
  }
}

function sameScope(left: ScopedResource, right: ScopedResource): boolean {
  return (
    left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    (left.kind !== "team" ||
      (right.kind === "team" && left.teamId === right.teamId)) &&
    (left.kind !== "user" ||
      (right.kind === "user" && left.userId === right.userId))
  );
}

export function buildMergeKnowledgeNodes(dependencies: {
  readonly clock: () => Date;
  readonly repository: KnowledgeGraphRepository;
}) {
  return async function execute(
    access: OrganizationAccess,
    targetNodeId: string,
    sourceNodeId: string,
    reason: string
  ): Promise<KnowledgeNode> {
    if (targetNodeId === sourceNodeId) {
      throw new InvalidKnowledgeNodeMergeError(
        "source and target knowledge nodes must differ"
      );
    }
    const normalizedReason = reason.trim();
    if (normalizedReason.length === 0 || normalizedReason.length > 2_000) {
      throw new InvalidKnowledgeNodeMergeError(
        "knowledge node merge reason must be between 1 and 2000 characters"
      );
    }
    const [source, target] = await Promise.all([
      dependencies.repository.findNodeById(
        access.organizationId,
        sourceNodeId
      ),
      dependencies.repository.findNodeById(
        access.organizationId,
        targetNodeId
      )
    ]);
    if (!source || !target) {
      throw new KnowledgeNodeNotFoundError();
    }
    if (
      !canAccessScopedResource(access, "manage", source.scope) ||
      !canAccessScopedResource(access, "manage", target.scope)
    ) {
      throw new KnowledgeGraphAccessDeniedError();
    }
    if (!sameScope(source.scope, target.scope)) {
      throw new InvalidKnowledgeNodeMergeError(
        "knowledge nodes from different scopes cannot be merged"
      );
    }
    const merged = await dependencies.repository.mergeNodes({
      organizationId: access.organizationId,
      sourceNodeId,
      targetNodeId,
      mergedBy: access.userId,
      reason: normalizedReason,
      now: dependencies.clock()
    });
    if (!merged) {
      throw new KnowledgeNodeNotFoundError();
    }
    return merged;
  };
}
