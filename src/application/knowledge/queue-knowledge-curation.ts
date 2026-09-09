import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { DocumentKnowledgeEnrichmentQueue } from "@/domain/document/document-services";
import type { OrganizationAccess } from "@/domain/identity/organization-access";

export function buildQueueKnowledgeCuration(repository: KnowledgeCandidateRepository, queue: DocumentKnowledgeEnrichmentQueue) {
  return async (access: OrganizationAccess) => {
    const sources = await repository.listReviewSources(access);
    let queued = 0;
    for (const { candidate } of sources) {
      const reviewed = new Set(candidate.itemReviews?.map((review) => review.item));
      if (candidate.assessment && !candidate.assessment.items.some((item) => item.verdict !== "review" && !reviewed.has(item.item))) { continue; }
      if (await queue.enqueueKnowledgeEnrichment(access.organizationId, candidate.chunkId, access.userId) === "queued") { queued += 1; }
    }
    return { queued };
  };
}

export function buildListKnowledgeCurationHistory(repository: KnowledgeCandidateRepository) {
  return (access: OrganizationAccess) => repository.listReviewSources(access, true);
}
