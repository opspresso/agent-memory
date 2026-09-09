import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { groupKnowledgeReviewSources } from "@/domain/knowledge/knowledge-review-group";
import { InvalidKnowledgeCandidateError } from "@/domain/knowledge/knowledge-candidate";

export function buildListKnowledgeReviewGroups(repository: KnowledgeCandidateRepository) {
  return async (access: OrganizationAccess, options: { offset: number; limit: number; query?: string }) => {
    if (!Number.isSafeInteger(options.offset) || options.offset < 0 ||
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100 ||
      (options.query?.length ?? 0) > 500) {
      throw new InvalidKnowledgeCandidateError("invalid review group pagination");
    }
    const sources = await repository.listReviewSources(access);
    const query = options.query?.normalize("NFKC").trim().toLowerCase();
    const groups = groupKnowledgeReviewSources(sources).filter((group) => !query ||
      group.title.normalize("NFKC").toLowerCase().includes(query) ||
      group.occurrences.some((occurrence) => occurrence.documentTitle.normalize("NFKC").toLowerCase().includes(query)));
    return { groups: groups.slice(options.offset, options.offset + options.limit), total: groups.length,
      sourceCount: sources.length, offset: options.offset, limit: options.limit };
  };
}
