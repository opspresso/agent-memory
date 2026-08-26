import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
import {
  createKnowledgeNode,
  type KnowledgeNode,
  type KnowledgeSource
} from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

export interface CreateKnowledgeNodeInput {
  readonly access: OrganizationAccess;
  readonly scope: ScopedResource;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly source?: KnowledgeSource;
}

export interface CreateKnowledgeNodeDependencies {
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly generateId: () => string;
  readonly repository: KnowledgeGraphRepository;
}

export class KnowledgeGraphAccessDeniedError extends Error {
  constructor() {
    super("knowledge graph access denied");
    this.name = "KnowledgeGraphAccessDeniedError";
  }
}

export function buildCreateKnowledgeNode(
  dependencies: CreateKnowledgeNodeDependencies
) {
  return async function execute(
    input: CreateKnowledgeNodeInput
  ): Promise<KnowledgeNode> {
    if (!canAccessScopedResource(input.access, "write", input.scope)) {
      throw new KnowledgeGraphAccessDeniedError();
    }

    const embedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(
          `${input.canonicalName.trim()}\n${input.summary?.trim() ?? ""}`
        )
      : undefined;
    const node = createKnowledgeNode({
      id: dependencies.generateId(),
      scope: input.scope,
      kind: input.kind,
      canonicalName: input.canonicalName,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(embedding ? { embedding } : {}),
      ...(input.properties ? { properties: input.properties } : {}),
      ...(input.source ? { source: input.source } : {}),
      now: dependencies.clock()
    });
    return dependencies.repository.saveNode(node);
  };
}
