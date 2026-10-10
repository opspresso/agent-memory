import type { ProposedKnowledgeGraph } from "./knowledge-candidate";
import type { AiRequestQuotaKey } from "../shared/ai-request-limiter";
import type { OrganizationAccess } from "../identity/organization-access";

export type KnowledgeExtractionLanguage = "source" | "ko" | "en";

export interface KnowledgeExtractionPrincipal {
  readonly userId: string;
  readonly action: "write" | "manage";
  readonly principalKind?: OrganizationAccess["principalKind"];
}

export interface KnowledgeExtractionResult {
  readonly model: string;
  readonly graph: ProposedKnowledgeGraph;
}

export interface KnowledgeExtractionOntologyHint {
  readonly nodeKinds: readonly string[];
  readonly edgePredicates: readonly string[];
  readonly mode: "warn" | "strict";
}

export interface KnowledgeExtractionService {
  extract(input: {
    readonly content: string;
    readonly documentTitle: string;
    readonly mimeType: string;
    readonly ontology?: KnowledgeExtractionOntologyHint;
    readonly quotaKey?: AiRequestQuotaKey;
    readonly source?: { readonly organizationId: string; readonly chunkId: string };
  }): Promise<KnowledgeExtractionResult>;
}
