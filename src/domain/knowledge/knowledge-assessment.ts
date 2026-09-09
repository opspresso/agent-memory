export interface KnowledgeItemVerification {
  readonly item: string;
  readonly support: "explicit" | "uncertain" | "unsupported";
  readonly usefulness: "useful" | "incidental";
  readonly conflict: boolean;
  readonly evidence: string;
  readonly reason: string;
}

export interface KnowledgeCandidateAssessment {
  readonly model: string;
  readonly policyVersion: "evidence-v1";
  readonly assessedAt: string;
  readonly items: readonly {
    readonly item: string;
    readonly verdict: "accept" | "review" | "ignore";
    readonly evidence: string;
    readonly reason: string;
  }[];
}
