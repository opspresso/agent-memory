import type { MemoryEmbedding } from "../memory/memory";
import type { OrganizationAccess } from "../identity/organization-access";
import type { KnowledgeCandidate } from "./knowledge-candidate";
import type { KnowledgeEdge, KnowledgeNode } from "./knowledge-graph";

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
  | Readonly<{ status: "already_rejected" }>;

export interface KnowledgeCandidateRepository {
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
    readonly entityPromotions: readonly KnowledgeCandidateEntityPromotion[];
    readonly organizationId: string;
    readonly reason?: string;
    readonly relationshipIds: readonly string[];
    readonly reviewedAt: Date;
    readonly reviewedBy: string;
  }): Promise<KnowledgeCandidateAcceptResult>;
  reject(input: {
    readonly candidateId: string;
    readonly organizationId: string;
    readonly reason?: string;
    readonly reviewedAt: Date;
    readonly reviewedBy: string;
  }): Promise<KnowledgeCandidate | null>;
}
