import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import {
  createKnowledgeOntology,
  emptyKnowledgeOntology,
  type KnowledgeOntology
} from "@/domain/knowledge/knowledge-ontology";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";
import type { KnowledgeOntologySuggestionService } from "@/domain/knowledge/knowledge-ontology-suggestion-service";
import type {
  KnowledgeOntologyTermUsage,
  KnowledgeTermUsageRepository
} from "@/domain/knowledge/knowledge-term-usage";

export class KnowledgeOntologyAccessDeniedError extends Error {
  constructor() {
    super("knowledge ontology administration access denied");
    this.name = "KnowledgeOntologyAccessDeniedError";
  }
}

export class KnowledgeOntologySuggestionUnavailableError extends Error {
  constructor() {
    super("knowledge ontology suggestions require a configured extraction model");
    this.name = "KnowledgeOntologySuggestionUnavailableError";
  }
}

const RECOMMENDATION_LIMIT = 20;

export interface KnowledgeOntologyRecommendation {
  readonly nodeKinds: readonly KnowledgeOntologyTermUsage[];
  readonly edgePredicates: readonly KnowledgeOntologyTermUsage[];
}

interface RecommendOntologyDependencies {
  readonly ontologyReader: KnowledgeOntologyReader;
  readonly usageRepository: KnowledgeTermUsageRepository;
}

function authorizeOntologyAdministrator(access: OrganizationAccess): void {
  const organizationScope = {
    kind: "organization",
    organizationId: access.organizationId
  } as const;
  if (!canAccessScopedResource(access, "manage", organizationScope)) {
    throw new KnowledgeOntologyAccessDeniedError();
  }
}

function newTerms(
  usage: readonly KnowledgeOntologyTermUsage[],
  existing: readonly string[]
): readonly KnowledgeOntologyTermUsage[] {
  const known = new Set(existing);
  return usage
    .filter((entry) => !known.has(entry.term))
    .toSorted((left, right) => right.count - left.count)
    .slice(0, RECOMMENDATION_LIMIT);
}

export function buildRecommendKnowledgeOntologyTerms(
  dependencies: RecommendOntologyDependencies
) {
  return async function execute(
    access: OrganizationAccess
  ): Promise<KnowledgeOntologyRecommendation> {
    authorizeOntologyAdministrator(access);
    const [settings, usage] = await Promise.all([
      dependencies.ontologyReader.findByOrganization(access.organizationId),
      dependencies.usageRepository.collect(access.organizationId)
    ]);
    const ontology = settings?.ontology ?? emptyKnowledgeOntology;
    return {
      nodeKinds: newTerms(usage.nodeKinds, ontology.nodeKinds),
      edgePredicates: newTerms(usage.edgePredicates, ontology.edgePredicates)
    };
  };
}

export function buildSuggestKnowledgeOntology(
  dependencies: RecommendOntologyDependencies & {
    readonly suggestionService?: KnowledgeOntologySuggestionService;
  }
) {
  return async function execute(
    access: OrganizationAccess
  ): Promise<KnowledgeOntology> {
    authorizeOntologyAdministrator(access);
    if (!dependencies.suggestionService) {
      throw new KnowledgeOntologySuggestionUnavailableError();
    }
    const [settings, usage] = await Promise.all([
      dependencies.ontologyReader.findByOrganization(access.organizationId),
      dependencies.usageRepository.collect(access.organizationId)
    ]);
    const ontology = settings?.ontology ?? emptyKnowledgeOntology;
    const suggested = await dependencies.suggestionService.suggest({
      usage,
      ontology
    });
    const normalized = createKnowledgeOntology({
      nodeKinds: suggested.nodeKinds.slice(0, RECOMMENDATION_LIMIT),
      edgePredicates: suggested.edgePredicates.slice(0, RECOMMENDATION_LIMIT)
    });
    const knownKinds = new Set(ontology.nodeKinds);
    const knownPredicates = new Set(ontology.edgePredicates);
    return {
      nodeKinds: normalized.nodeKinds.filter((term) => !knownKinds.has(term)),
      edgePredicates: normalized.edgePredicates.filter(
        (term) => !knownPredicates.has(term)
      )
    };
  };
}
