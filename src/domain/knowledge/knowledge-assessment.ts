export const currentKnowledgeAssessmentPolicyVersion = "evidence-v5";
export const knowledgeRepresentations = ["entity", "relationship", "attribute", "generic_reference", "uncertain"] as const;
export type KnowledgeRepresentation = (typeof knowledgeRepresentations)[number];

export function limitKnowledgeAssessmentReason(reason: string): string {
  return reason.length > 1_000 ? `${reason.slice(0, 999)}…` : reason;
}

export interface KnowledgeItemVerification {
  readonly item: string;
  readonly representation: KnowledgeRepresentation;
  readonly entityKind?: string;
  readonly support: "explicit" | "uncertain" | "unsupported";
  readonly usefulness: "useful" | "incidental";
  readonly conflict: boolean;
  readonly evidence: string;
  readonly reason: string;
}

export interface KnowledgeAliasVerification {
  readonly entityKey: string;
  readonly alias: string;
  readonly descriptiveExpansion?: boolean;
  readonly identity: "same_entity" | "generic_reference" | "different_entity" | "uncertain";
  readonly evidence: string;
  readonly reason: string;
}

export interface KnowledgeCandidateAssessment {
  readonly model: string;
  readonly policyVersion: string;
  readonly assessedAt: string;
  readonly aliases?: readonly (KnowledgeAliasVerification & { readonly verdict: "accept" | "review" | "ignore" })[];
  readonly items: readonly {
    readonly item: string;
    readonly representation?: KnowledgeRepresentation;
    readonly entityKind?: string;
    readonly support?: KnowledgeItemVerification["support"];
    readonly usefulness?: KnowledgeItemVerification["usefulness"];
    readonly conflict?: boolean;
    readonly verdict: "accept" | "review" | "ignore";
    readonly evidence: string;
    readonly reason: string;
  }[];
}
