import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { OrganizationAccess } from "@/domain/identity/organization-access";
import { groupKnowledgeReviewSources } from "@/domain/knowledge/knowledge-review-group";
import { InvalidKnowledgeCandidateError } from "@/domain/knowledge/knowledge-candidate";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";
import { evaluateKnowledgeOntology } from "@/domain/knowledge/knowledge-ontology";
import { entityReviewKey, relationshipReviewKey, selectKnowledgeCandidateItems } from "@/domain/knowledge/knowledge-candidate-selection";

export function buildListKnowledgeReviewGroups(repository: KnowledgeCandidateRepository, ontologyReader: KnowledgeOntologyReader) {
  return async (access: OrganizationAccess, options: { offset: number; limit: number; query?: string }) => {
    if (!Number.isSafeInteger(options.offset) || options.offset < 0 ||
      !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100 ||
      (options.query?.length ?? 0) > 500) {
      throw new InvalidKnowledgeCandidateError("invalid review group pagination");
    }
    const sources = await repository.listReviewSources(access);
    const query = options.query?.normalize("NFKC").trim().toLowerCase();
    const settings = await ontologyReader.findByOrganization(access.organizationId);
    const reviewSources = sources.map((source) => {
      const { candidate } = source;
      if (settings?.mode !== "strict" || !candidate.assessment) { return source; }
      const reviewed = new Set(candidate.itemReviews?.map((item) => item.item));
      const accepted = new Set(candidate.assessment.items.filter((item) => item.verdict === "accept" && !reviewed.has(item.item)).map((item) => item.item));
      const selection = {
        entityKeys: candidate.graph.entities.filter((entity) => accepted.has(entityReviewKey(entity.key))).map((entity) => entity.key),
        relationshipIndexes: candidate.graph.relationships.flatMap((_, index) => accepted.has(relationshipReviewKey(index)) ? [index] : [])
      };
      if (accepted.size === 0) { return source; }
      const graph = selectKnowledgeCandidateItems(candidate, selection).graph;
      const violations = evaluateKnowledgeOntology(settings.ontology, {
        kinds: graph.entities.map((entity) => entity.kind), predicates: graph.relationships.map((relationship) => relationship.predicate)
      });
      if (violations.length === 0) { return source; }
      // Automatic acceptance is atomic for this selection. Surface the blocked
      // batch without rewriting the original verifier assessment or its audit.
      return { ...source, candidate: { ...candidate, assessment: { ...candidate.assessment,
        items: candidate.assessment.items.map((item) => accepted.has(item.item)
          ? { ...item, verdict: "review" as const, reason: "Automatic acceptance is blocked by the current strict ontology." } : item)
      } } };
    });
    const groups = groupKnowledgeReviewSources(reviewSources, true).filter((group) => !query ||
      group.title.normalize("NFKC").toLowerCase().includes(query) ||
      group.occurrences.some((occurrence) => occurrence.documentTitle.normalize("NFKC").toLowerCase().includes(query)));
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
