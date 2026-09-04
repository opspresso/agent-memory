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
import {
  enforceKnowledgeOntology,
  evaluateKnowledgeOntology,
  type KnowledgeOntologyViolation
} from "@/domain/knowledge/knowledge-ontology";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

import type { AuthorizeKnowledgeSource } from "./authorize-knowledge-source";

export interface CreateKnowledgeNodeInput {
  readonly access: OrganizationAccess;
  readonly scope: ScopedResource;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly source: KnowledgeSource;
}

export interface CreateKnowledgeNodeDependencies {
  readonly authorizeSource: AuthorizeKnowledgeSource;
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly generateId: () => string;
  readonly ontologyReader: KnowledgeOntologyReader;
  readonly repository: KnowledgeGraphRepository;
}

export interface CreateKnowledgeNodeResult {
  readonly node: KnowledgeNode;
  readonly ontologyWarnings: readonly KnowledgeOntologyViolation[];
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
  ): Promise<CreateKnowledgeNodeResult> {
    if (!canAccessScopedResource(input.access, "write", input.scope)) {
      throw new KnowledgeGraphAccessDeniedError();
    }

    await dependencies.authorizeSource(input.access, input.source, input.scope);

    const settings = await dependencies.ontologyReader.findByOrganization(
      input.access.organizationId
    );
    const ontologyWarnings = settings
      ? enforceKnowledgeOntology(
          settings.mode,
          evaluateKnowledgeOntology(settings.ontology, { kinds: [input.kind] })
        )
      : [];

    const embedding = dependencies.embeddingService
      ? await dependencies.embeddingService.embed(
          `${input.canonicalName.trim()}\n${input.summary?.trim() ?? ""}`
        )
      : undefined;
    const created = createKnowledgeNode({
      id: dependencies.generateId(),
      scope: input.scope,
      kind: input.kind,
      canonicalName: input.canonicalName,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(embedding ? { embedding } : {}),
      ...(input.properties ? { properties: input.properties } : {}),
      source: input.source,
      now: dependencies.clock()
    });
    const node = await dependencies.repository.saveNode(created);
    return { node, ontologyWarnings };
  };
}
