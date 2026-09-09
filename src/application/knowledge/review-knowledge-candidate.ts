import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import { selectKnowledgeCandidateItems } from "@/domain/knowledge/knowledge-candidate-selection";
import type { KnowledgeCandidateSelection } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type {
  KnowledgeCandidateAcceptResult,
  KnowledgeCandidatePromotionResult,
  KnowledgeCandidateRepository
} from "@/domain/knowledge/knowledge-candidate-repository";
import type { KnowledgeNode } from "@/domain/knowledge/knowledge-graph";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";
import {
  enforceKnowledgeOntology,
  evaluateKnowledgeOntology,
  type KnowledgeOntologyMode,
  type KnowledgeOntologyViolation
} from "@/domain/knowledge/knowledge-ontology";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";
import type { TextEmbeddingService } from "@/domain/shared/text-embedding-service";

export class KnowledgeCandidateReviewAccessDeniedError extends Error {
  constructor() {
    super("knowledge candidate review access denied");
    this.name = "KnowledgeCandidateReviewAccessDeniedError";
  }
}

export class KnowledgeCandidateNotFoundError extends Error {
  constructor() {
    super("knowledge candidate not found");
    this.name = "KnowledgeCandidateNotFoundError";
  }
}

export class KnowledgeCandidateReviewConflictError extends Error {
  constructor() {
    super("knowledge candidate has already been reviewed");
    this.name = "KnowledgeCandidateReviewConflictError";
  }
}

export class InvalidKnowledgeCandidateReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledgeCandidateReviewError";
  }
}

export class KnowledgeCandidateSourceNotReadyError extends Error {
  constructor() {
    super("knowledge candidate source document is not ready");
    this.name = "KnowledgeCandidateSourceNotReadyError";
  }
}

function authorizeReviewer(
  access: OrganizationAccess,
  candidate: KnowledgeCandidate
) {
  if (!canAccessScopedResource(access, "manage", candidate.scope)) {
    throw new KnowledgeCandidateReviewAccessDeniedError();
  }
}

function normalizedReason(reason: string | undefined) {
  const normalized = reason?.trim();
  if (normalized && normalized.length > 2_000) {
    throw new InvalidKnowledgeCandidateReviewError(
      "knowledge candidate review reason is too long"
    );
  }
  return normalized;
}

interface ReviewKnowledgeCandidateDependencies {
  readonly method?: "human" | "automatic";
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly generateId: () => string;
  readonly ontologyReader: KnowledgeOntologyReader;
  readonly repository: KnowledgeCandidateRepository;
}

function candidateOntologyTerms(candidate: KnowledgeCandidate) {
  return {
    kinds: candidate.graph.entities.map((entity) => entity.kind),
    predicates: candidate.graph.relationships.map(
      (relationship) => relationship.predicate
    )
  };
}

export function buildListKnowledgeCandidates(
  repository: KnowledgeCandidateRepository
) {
  return async function execute(
    access: OrganizationAccess,
    limit = 50
  ): Promise<readonly KnowledgeCandidate[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InvalidKnowledgeCandidateReviewError(
        "knowledge candidate limit must be between 1 and 100"
      );
    }
    return repository.listPending(access, limit);
  };
}

export interface KnowledgeCandidateDuplicatesResult {
  readonly duplicates: Readonly<Record<string, readonly KnowledgeNode[]>>;
  readonly ontology: Readonly<{
    mode: KnowledgeOntologyMode;
    violations: readonly KnowledgeOntologyViolation[];
  }>;
}

export function buildFindKnowledgeCandidateDuplicates(dependencies: {
  readonly candidateRepository: KnowledgeCandidateRepository;
  readonly graphRepository: KnowledgeGraphRepository;
  readonly ontologyReader: KnowledgeOntologyReader;
}) {
  return async function execute(
    access: OrganizationAccess,
    candidateId: string
  ): Promise<KnowledgeCandidateDuplicatesResult> {
    const candidate = await dependencies.candidateRepository.findById(
      access.organizationId,
      candidateId
    );
    if (!candidate) {
      throw new KnowledgeCandidateNotFoundError();
    }
    authorizeReviewer(access, candidate);
    const settings = await dependencies.ontologyReader.findByOrganization(
      access.organizationId
    );
    const nodes = await dependencies.graphRepository.findNodesByCanonicalNames(
      access,
      candidate.scope,
      candidate.graph.entities.map((entity) => entity.canonicalName)
    );
    const duplicates = Object.fromEntries(
      candidate.graph.entities.map((entity) => {
        const identity = knowledgeCanonicalNameKey(entity.canonicalName);
        return [
          entity.key,
          nodes.filter(
            (node) => knowledgeCanonicalNameKey(node.canonicalName) === identity
          )
        ];
      })
    );
    return {
      duplicates,
      ontology: {
        mode: settings?.mode ?? "off",
        violations:
          settings && settings.mode !== "off"
            ? evaluateKnowledgeOntology(
                settings.ontology,
                candidateOntologyTerms(candidate)
              )
            : []
      }
    };
  };
}

export type AcceptKnowledgeCandidateResult = KnowledgeCandidatePromotionResult &
  Readonly<{ ontologyWarnings: readonly KnowledgeOntologyViolation[] }>;

export function buildAcceptKnowledgeCandidate(
  dependencies: ReviewKnowledgeCandidateDependencies
) {
  return async function execute(
    access: OrganizationAccess,
    candidateId: string,
    reason?: string,
    selection?: KnowledgeCandidateSelection
  ): Promise<AcceptKnowledgeCandidateResult> {
    const candidate = await dependencies.repository.findById(
      access.organizationId,
      candidateId
    );
    if (!candidate) {
      throw new KnowledgeCandidateNotFoundError();
    }
    authorizeReviewer(access, candidate);
    if (candidate.status === "rejected") {
      throw new KnowledgeCandidateReviewConflictError();
    }
    if (selection) { selectKnowledgeCandidateItems(candidate, selection); }
    if (candidate.status === "accepted") {
      const existing = await dependencies.repository.accept({
        candidateId,
        entityPromotions: [],
        organizationId: access.organizationId,
        relationshipIds: [],
        reviewedAt: dependencies.clock(),
        reviewedBy: access.userId
      });
      return { ...promotionFromAcceptResult(existing), ontologyWarnings: [] };
    }
    const selected = selectKnowledgeCandidateItems(candidate, selection);
    if (candidate.graph.entities.length === 0) {
      throw new InvalidKnowledgeCandidateReviewError("empty extraction cannot be accepted");
    }
    const settings = await dependencies.ontologyReader.findByOrganization(
      access.organizationId
    );
    const ontologyWarnings = settings
      ? enforceKnowledgeOntology(
          settings.mode,
          evaluateKnowledgeOntology(
            settings.ontology,
            candidateOntologyTerms({ ...candidate, graph: selected.graph })
          )
        )
      : [];
    const embeddings = dependencies.embeddingService
      ? await dependencies.embeddingService.embedMany(
          selected.graph.entities.map(
            (entity) => `${entity.canonicalName}\n${entity.summary ?? ""}`
          ),
          {
            organizationId: access.organizationId,
            userId: access.userId
          }
        )
      : [];
    if (
      dependencies.embeddingService &&
      embeddings.length !== selected.graph.entities.length
    ) {
      throw new Error(
        "embedding result count does not match knowledge candidate entities"
      );
    }
    const entityPromotions = selected.graph.entities.map((entity, index) => ({
      key: entity.key,
      id: dependencies.generateId(),
      ...(embeddings[index] ? { embedding: embeddings[index] } : {})
    }));
    const promoted = await dependencies.repository.accept({
      candidateId,
      entityPromotions,
      ...(selection ? { selection } : {}),
      ...(dependencies.method ? { method: dependencies.method } : {}),
      organizationId: access.organizationId,
      ...(normalizedReason(reason) ? { reason: normalizedReason(reason) } : {}),
      relationshipIds: candidate.graph.relationships.map(() =>
        dependencies.generateId()
      ),
      reviewedAt: dependencies.clock(),
      reviewedBy: access.userId
    });
    return { ...promotionFromAcceptResult(promoted), ontologyWarnings };
  };
}

function promotionFromAcceptResult(
  result: KnowledgeCandidateAcceptResult
): KnowledgeCandidatePromotionResult {
  if (result.status === "not_found") {
    throw new KnowledgeCandidateNotFoundError();
  }
  if (result.status === "source_not_ready") {
    throw new KnowledgeCandidateSourceNotReadyError();
  }
  if (result.status === "already_rejected") {
    throw new KnowledgeCandidateReviewConflictError();
  }
  return { candidate: result.candidate, nodes: result.nodes, edges: result.edges };
}

export function buildRejectKnowledgeCandidate(
  dependencies: Pick<
    ReviewKnowledgeCandidateDependencies,
    "clock" | "repository" | "method"
  >
) {
  return async function execute(
    access: OrganizationAccess,
    candidateId: string,
    reason?: string,
    selection?: KnowledgeCandidateSelection
  ): Promise<KnowledgeCandidate> {
    const candidate = await dependencies.repository.findById(
      access.organizationId,
      candidateId
    );
    if (!candidate) {
      throw new KnowledgeCandidateNotFoundError();
    }
    authorizeReviewer(access, candidate);
    const selected = selectKnowledgeCandidateItems(candidate, selection, "rejected");
    if (candidate.status === "accepted") {
      if (selection && selected.items.length === 0) { return candidate; }
      throw new KnowledgeCandidateReviewConflictError();
    }
    const normalized = normalizedReason(reason);
    const rejected = await dependencies.repository.reject({
      candidateId,
      ...(selection ? { selection } : {}),
      ...(dependencies.method ? { method: dependencies.method } : {}),
      organizationId: access.organizationId,
      ...(normalized ? { reason: normalized } : {}),
      reviewedAt: dependencies.clock(),
      reviewedBy: access.userId
    });
    if (!rejected) {
      throw new KnowledgeCandidateReviewConflictError();
    }
    return rejected;
  };
}
