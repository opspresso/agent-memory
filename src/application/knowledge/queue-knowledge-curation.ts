import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { DocumentKnowledgeEnrichmentQueue } from "@/domain/document/document-services";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { InvalidKnowledgeCandidateError, canUpgradeKnowledgeExtraction } from "@/domain/knowledge/knowledge-candidate";

export function buildQueueKnowledgeCuration(repository: Pick<KnowledgeCandidateRepository, "listReviewSources">, queue: DocumentKnowledgeEnrichmentQueue) {
  return async (access: OrganizationAccess, query?: string) => {
    if ((query?.length ?? 0) > 500) { throw new InvalidKnowledgeCandidateError("curation query must not exceed 500 characters"); }
    const term = query?.normalize("NFKC").trim().toLowerCase();
    const sources = await repository.listReviewSources(access);
    let queued = 0;
    for (const { candidate } of sources) {
      if (term && !candidate.graph.entities.some((entity) => [entity.canonicalName, ...(entity.aliases ?? [])]
        .some((name) => name.normalize("NFKC").toLowerCase().includes(term)))) { continue; }
      const reviewed = new Set(candidate.itemReviews?.map((review) => review.item));
      if (!canUpgradeKnowledgeExtraction(candidate) && candidate.assessment && !candidate.assessment.items.some((item) => item.verdict !== "review" && !reviewed.has(item.item))) { continue; }
      if (term) {
        await queue.enqueueKnowledgeEnrichment(access.organizationId, candidate.chunkId, access.userId, 20);
        queued += 1;
      } else if (await queue.enqueueKnowledgeEnrichment(access.organizationId, candidate.chunkId, access.userId) === "queued") { queued += 1; }
    }
    return { queued };
  };
}

export function buildListKnowledgeCurationHistory(repository: KnowledgeCandidateRepository) {
  return (access: OrganizationAccess) => repository.listReviewSources(access, true);
}

export function buildKnowledgeProcessingProgress(repository: KnowledgeCandidateRepository) {
  return (access: OrganizationAccess) => repository.processingProgress(access);
}
