export interface KnowledgeItemVerification {
  readonly item: string;
  readonly support: "explicit" | "uncertain" | "unsupported";
  readonly usefulness: "useful" | "incidental";
  readonly conflict: boolean;
  readonly evidence: string;
  readonly reason: string;
}

export interface KnowledgeAliasVerification {
  readonly entityKey: string;
  readonly alias: string;
  readonly identity: "same_entity" | "generic_reference" | "different_entity" | "uncertain";
  readonly evidence: string;
  readonly reason: string;
}

export interface KnowledgeCandidateAssessment {
  readonly model: string;
  readonly policyVersion: "evidence-v2";
  readonly assessedAt: string;
  readonly aliases?: readonly (KnowledgeAliasVerification & { readonly verdict: "accept" | "review" | "ignore" })[];
  readonly items: readonly {
    readonly item: string;
    readonly verdict: "accept" | "review" | "ignore";
    readonly evidence: string;
    readonly reason: string;
  }[];
}
