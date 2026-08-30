import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
import {
  createKnowledgeEdge,
  type KnowledgeEdge,
  type KnowledgeNode,
  type KnowledgeSource
} from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";
import {
  enforceKnowledgeOntology,
  evaluateKnowledgeOntology,
  type KnowledgeOntologyViolation
} from "@/domain/knowledge/knowledge-ontology";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";

import {
  KnowledgeSourceNotFoundError,
  type AuthorizeKnowledgeSource
} from "./authorize-knowledge-source";
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
  readonly authorizeSource: AuthorizeKnowledgeSource;
  readonly clock: () => Date;
  readonly generateId: () => string;
  readonly ontologyReader: KnowledgeOntologyReader;
  readonly repository: KnowledgeGraphRepository;
}

export interface CreateKnowledgeEdgeResult {
  readonly edge: KnowledgeEdge;
  readonly ontologyWarnings: readonly KnowledgeOntologyViolation[];
}

export class KnowledgeNodeNotFoundError extends Error {
  constructor() {
    super("knowledge node not found");
    this.name = "KnowledgeNodeNotFoundError";
  }
}

async function hasReadableSource(
  authorizeSource: AuthorizeKnowledgeSource,
  access: OrganizationAccess,
  node: KnowledgeNode
): Promise<boolean> {
  for (const source of node.sources) {
    try {
      await authorizeSource(access, source, node.scope);
      return true;
    } catch (error) {
      if (error instanceof KnowledgeSourceNotFoundError) {
        continue;
      }
      throw error;
    }
  }
  return false;
}

export function buildCreateKnowledgeEdge(
  dependencies: CreateKnowledgeEdgeDependencies
) {
  return async function execute(
    input: CreateKnowledgeEdgeInput
  ): Promise<CreateKnowledgeEdgeResult> {
    if (!canAccessScopedResource(input.access, "write", input.scope)) {
      throw new KnowledgeGraphAccessDeniedError();
    }

    if (input.source) {
      await dependencies.authorizeSource(
        input.access,
        input.source,
        input.scope
      );
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
    const [canReadSourceNode, canReadTargetNode] = await Promise.all([
      hasReadableSource(
        dependencies.authorizeSource,
        input.access,
        sourceNode
      ),
      hasReadableSource(
        dependencies.authorizeSource,
        input.access,
        targetNode
      )
    ]);
    if (!canReadSourceNode || !canReadTargetNode) {
      throw new KnowledgeNodeNotFoundError();
    }

    const settings = await dependencies.ontologyReader.findByOrganization(
      input.access.organizationId
    );
    const ontologyWarnings = settings
      ? enforceKnowledgeOntology(
          settings.mode,
          evaluateKnowledgeOntology(settings.ontology, {
            predicates: [input.predicate]
          })
        )
      : [];

    const edge = await dependencies.repository.saveEdge(
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
    return { edge, ontologyWarnings };
  };
}
