import {
  canAccessScopedResource,
  type OrganizationAccess
} from "@/domain/identity/organization-access";
import type { KnowledgeCandidate } from "@/domain/knowledge/knowledge-candidate";
import type {
  KnowledgeCandidatePromotionResult,
  KnowledgeCandidateRepository
} from "@/domain/knowledge/knowledge-candidate-repository";
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
  readonly clock: () => Date;
  readonly embeddingService?: TextEmbeddingService;
  readonly generateId: () => string;
  readonly repository: KnowledgeCandidateRepository;
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

export function buildAcceptKnowledgeCandidate(
  dependencies: ReviewKnowledgeCandidateDependencies
) {
  return async function execute(
    access: OrganizationAccess,
    candidateId: string,
    reason?: string
  ): Promise<KnowledgeCandidatePromotionResult> {
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
    if (candidate.status === "accepted") {
      const existing = await dependencies.repository.accept({
        candidateId,
        entityPromotions: [],
        organizationId: access.organizationId,
        relationshipIds: [],
        reviewedAt: dependencies.clock(),
        reviewedBy: access.userId
      });
      if (!existing) {
        throw new KnowledgeCandidateReviewConflictError();
      }
      return existing;
    }
    const entityPromotions = await Promise.all(
      candidate.graph.entities.map(async (entity) => ({
        key: entity.key,
        id: dependencies.generateId(),
        ...(dependencies.embeddingService
          ? {
              embedding: await dependencies.embeddingService.embed(
                `${entity.canonicalName}\n${entity.summary ?? ""}`
              )
            }
          : {})
      }))
    );
    const promoted = await dependencies.repository.accept({
      candidateId,
      entityPromotions,
      organizationId: access.organizationId,
      ...(normalizedReason(reason) ? { reason: normalizedReason(reason) } : {}),
      relationshipIds: candidate.graph.relationships.map(() =>
        dependencies.generateId()
      ),
      reviewedAt: dependencies.clock(),
      reviewedBy: access.userId
    });
    if (!promoted) {
      throw new KnowledgeCandidateReviewConflictError();
    }
    return promoted;
  };
}

export function buildRejectKnowledgeCandidate(
  dependencies: Pick<
    ReviewKnowledgeCandidateDependencies,
    "clock" | "repository"
  >
) {
  return async function execute(
    access: OrganizationAccess,
    candidateId: string,
    reason?: string
  ): Promise<KnowledgeCandidate> {
    const candidate = await dependencies.repository.findById(
      access.organizationId,
      candidateId
    );
    if (!candidate) {
      throw new KnowledgeCandidateNotFoundError();
    }
    authorizeReviewer(access, candidate);
    if (candidate.status === "accepted") {
      throw new KnowledgeCandidateReviewConflictError();
    }
    const normalized = normalizedReason(reason);
    const rejected = await dependencies.repository.reject({
      candidateId,
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
