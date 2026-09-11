import type { Document } from "./document";
import type { OrganizationAccess, ScopedResource } from "../identity/organization-access";

export const knowledgeScopeSkipReasons = [
  "access_denied", "source_scope", "source_unavailable", "identity_conflict", "endpoint_scope", "connected_edge"
] as const;
export type KnowledgeScopeSkipReason = (typeof knowledgeScopeSkipReasons)[number];

export interface KnowledgeScopeChangeSummary {
  readonly nodes: { readonly updated: number; readonly unchanged: number; readonly skipped: number };
  readonly edges: { readonly updated: number; readonly unchanged: number; readonly skipped: number };
  readonly skipped: readonly { readonly resource: "node" | "edge"; readonly reason: KnowledgeScopeSkipReason; readonly count: number }[];
}

export interface ChangeDocumentScopeInput {
  readonly access: OrganizationAccess;
  readonly documentId: string;
  readonly scope: ScopedResource;
  readonly expectedUpdatedAt: string;
  readonly now: Date;
}

export interface DocumentScopeChangeRepository {
  changeScope(input: ChangeDocumentScopeInput): Promise<
    | { readonly status: "changed"; readonly document: Document; readonly knowledge: KnowledgeScopeChangeSummary }
    | { readonly status: "not_found" | "access_denied" | "conflict" | "not_ready" | "invalid_target" | "related_scope_conflict" }
  >;
}
