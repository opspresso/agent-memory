import type { MemoryEmbedding } from "../memory/memory";
import type { OrganizationAccess } from "../identity/organization-access";
import type { KnowledgeCandidate, KnowledgeCandidateSelection } from "./knowledge-candidate";
import type { KnowledgeEdge, KnowledgeNode } from "./knowledge-graph";
import type { KnowledgeReviewSource } from "./knowledge-review-group";
import type { KnowledgeCandidateAssessment } from "./knowledge-assessment";

export interface KnowledgeCandidateEntityPromotion {
  readonly key: string;
  readonly id: string;
  readonly embedding?: MemoryEmbedding;
}

export interface KnowledgeCandidatePromotionResult {
  readonly candidate: KnowledgeCandidate;
  readonly nodes: readonly KnowledgeNode[];
  readonly edges: readonly KnowledgeEdge[];
}

export type KnowledgeCandidateAcceptResult =
  | Readonly<{ status: "promoted" } & KnowledgeCandidatePromotionResult>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "source_not_ready" }>
  | Readonly<{ status: "already_rejected" }>
  | Readonly<{ status: "superseded" }>;

export interface KnowledgeCandidateRepository {
  replaceExtraction(previousId: string, candidate: KnowledgeCandidate): Promise<KnowledgeCandidate>;
  processingProgress(access: OrganizationAccess): Promise<{ readonly totalChunks: number; readonly extractedChunks: number; readonly curatedChunks: number }>;
  reviewSummary(access: OrganizationAccess): Promise<{ readonly automaticAccepted: number; readonly automaticIgnored: number }>;
  saveAssessment(organizationId: string, candidateId: string, assessment: KnowledgeCandidateAssessment): Promise<KnowledgeCandidate | null>;
  listReviewSources(access: OrganizationAccess, assessmentHistory?: boolean): Promise<readonly KnowledgeReviewSource[]>;
  findById(
    organizationId: string,
    candidateId: string
  ): Promise<KnowledgeCandidate | null>;
  findByChunkId(
    organizationId: string,
    chunkId: string
  ): Promise<KnowledgeCandidate | null>;
  listPending(
    access: OrganizationAccess,
    limit: number
  ): Promise<readonly KnowledgeCandidate[]>;
  save(candidate: KnowledgeCandidate): Promise<KnowledgeCandidate>;
  accept(input: {
    readonly candidateId: string;
    readonly selection?: KnowledgeCandidateSelection;
    readonly method?: "human" | "automatic";
    readonly entityPromotions: readonly KnowledgeCandidateEntityPromotion[];
    readonly organizationId: string;
    readonly reason?: string;
    readonly relationshipIds: readonly string[];
    readonly reviewedAt: Date;
    readonly reviewedBy: string;
  }): Promise<KnowledgeCandidateAcceptResult>;
  reject(input: {
    readonly candidateId: string;
    readonly selection?: KnowledgeCandidateSelection;
    readonly method?: "human" | "automatic";
    readonly organizationId: string;
    readonly reason?: string;
    readonly reviewedAt: Date;
    readonly reviewedBy: string;
  }): Promise<KnowledgeCandidate | null>;
}
