import type { ProposedKnowledgeGraph } from "./knowledge-candidate";
import type { AiRequestQuotaKey } from "../shared/ai-request-limiter";

import type { KnowledgeAliasVerification, KnowledgeItemVerification } from "./knowledge-assessment";

export interface KnowledgeVerificationService {
  verify(input: {
    readonly content: string;
    readonly documentTitle: string;
    readonly graph: ProposedKnowledgeGraph;
    readonly existingKnowledge: readonly { readonly name: string; readonly aliases: readonly string[]; readonly kind: string; readonly summary?: string }[];
    readonly quotaKey: AiRequestQuotaKey;
  }): Promise<{ readonly model: string; readonly items: readonly KnowledgeItemVerification[]; readonly aliases?: readonly KnowledgeAliasVerification[] }>;
}
