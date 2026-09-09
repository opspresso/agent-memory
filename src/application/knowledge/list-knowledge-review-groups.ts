import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { groupKnowledgeReviewSources } from "@/domain/knowledge/knowledge-review-group";
import { InvalidKnowledgeCandidateError } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";
import { evaluateKnowledgeOntology } from "@/domain/knowledge/knowledge-ontology";
import { selectKnowledgeCandidateItems } from "@/domain/knowledge/knowledge-candidate-selection";

export function buildListKnowledgeReviewGroups(repository: KnowledgeCandidateRepository, ontologyReader: KnowledgeOntologyReader) {
  return async (access: OrganizationAccess, options: { offset: number; limit: number; query?: string }) => {
    if (!Number.isSafeInteger(options.offset) || options.offset < 0 ||
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100 ||
      (options.query?.length ?? 0) > 500) {
      throw new InvalidKnowledgeCandidateError("invalid review group pagination");
    }
    const sources = await repository.listReviewSources(access);
    const query = options.query?.normalize("NFKC").trim().toLowerCase();
    const groups = groupKnowledgeReviewSources(sources, true).filter((group) => !query ||
      group.title.normalize("NFKC").toLowerCase().includes(query) ||
      group.occurrences.some((occurrence) => occurrence.documentTitle.normalize("NFKC").toLowerCase().includes(query)));
    const settings = await ontologyReader.findByOrganization(access.organizationId);
    const byId = new Map(sources.map((source) => [source.candidate.id, source.candidate]));
    const page = groups.slice(options.offset, options.offset + options.limit).map((group) => {
      const occurrence = group.occurrences[0]!;
      const graph = selectKnowledgeCandidateItems(byId.get(occurrence.candidateId)!, occurrence.selection).graph;
      return { ...group, ontology: { mode: settings?.mode ?? "off", violations: settings && settings.mode !== "off"
        ? evaluateKnowledgeOntology(settings.ontology, { kinds: graph.entities.map((entity) => entity.kind), predicates: graph.relationships.map((relationship) => relationship.predicate) }) : [] } };
    });
    const summary = await repository.reviewSummary(access);
    return { groups: page, total: groups.length, ...summary,
      unassessedCount: sources.filter((source) => !source.candidate.assessment).length,
      sourceCount: sources.length, offset: options.offset, limit: options.limit };
  };
}
