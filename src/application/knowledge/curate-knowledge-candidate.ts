import type { OrganizationAccessRepository } from "@/domain/identity/organization-access-repository";
import { canAccessScopedResource, type OrganizationAccess } from "@/domain/identity/organization-access";
import type { DocumentRepository } from "@/domain/document/document-repository";
import type { KnowledgeCandidateRepository } from "@/domain/knowledge/knowledge-candidate-repository";
import type { KnowledgeGraphRepository } from "@/domain/knowledge/knowledge-graph-repository";
import type { KnowledgeOntologyReader } from "@/domain/knowledge/knowledge-ontology-reader";
import type { KnowledgeVerificationService } from "@/domain/knowledge/knowledge-verification-service";
import type { KnowledgeCandidateSelection } from "@/domain/knowledge/knowledge-candidate";
import { assessKnowledgeCandidate } from "@/domain/knowledge/knowledge-curation-policy";
import { entityReviewKey, relationshipReviewKey } from "@/domain/knowledge/knowledge-candidate-selection";
import { KnowledgeOntologyViolationError } from "@/domain/knowledge/knowledge-ontology";
import { AmbiguousKnowledgeIdentityError } from "@/domain/knowledge/knowledge-alias";

type Review = (access: OrganizationAccess, id: string, reason: string, selection: KnowledgeCandidateSelection) => Promise<unknown>;

export function buildCurateKnowledgeCandidate(dependencies: {
  readonly candidates: Pick<KnowledgeCandidateRepository, "findByChunkId" | "saveAssessment" | "deferIdentityResolution">;
  readonly documents: Pick<DocumentRepository, "findChunkById">;
  readonly access: Pick<OrganizationAccessRepository, "findByUser">;
  readonly graph: Pick<KnowledgeGraphRepository, "findNodesByNames">;
  readonly ontology: KnowledgeOntologyReader;
  readonly verification: KnowledgeVerificationService;
  readonly accept: Review;
  readonly reject: Review;
  readonly clock: () => Date;
}) {
  return async function curate(organizationId: string, chunkId: string, requestedBy?: string): Promise<void> {
    let candidate = await dependencies.candidates.findByChunkId(organizationId, chunkId);
    if (!candidate || candidate.status !== "pending" || candidate.graph.entities.length === 0) { return; }
    const source = await dependencies.documents.findChunkById(organizationId, chunkId);
    if (!source || source.document.status !== "ready") { return; }
    const principalId = requestedBy ?? source.document.createdBy;
    let access = await dependencies.access.findByUser(organizationId, principalId);
    if (!access || !canAccessScopedResource(access, "manage", candidate.scope)) { return; }
    if (!candidate.assessment) {
      const existing = await dependencies.graph.findNodesByNames(access, candidate.scope, candidate.graph.entities.flatMap((entity) => [entity.canonicalName, ...(entity.aliases ?? [])]));
      const verification = await dependencies.verification.verify({
        content: source.chunk.content, documentTitle: source.document.title, graph: candidate.graph,
        existingKnowledge: existing.map((node) => ({ name: node.canonicalName, aliases: node.aliases.slice(0, 100), kind: node.kind, summary: node.summary?.slice(0, 2_000) })),
        quotaKey: { organizationId, userId: access.userId }
      });
      const ontology = await dependencies.ontology.findByOrganization(organizationId);
      candidate = await dependencies.candidates.saveAssessment(organizationId, candidate.id, assessKnowledgeCandidate({
        candidate, content: source.chunk.content, ...verification, ontology, now: dependencies.clock()
      }));
    }
    if (!candidate?.assessment || candidate.status !== "pending") { return; }
    // Verification can be slow: refresh the principal before any graph mutation.
    access = await dependencies.access.findByUser(organizationId, principalId);
    if (!access || !canAccessScopedResource(access, "manage", candidate.scope)) { return; }
    const reviewed = new Set(candidate.itemReviews?.map((review) => review.item));
    const verdicts = new Map(candidate.assessment.items.map((item) => [item.item, item.verdict]));
    const selectionFor = (verdict: "accept" | "ignore"): KnowledgeCandidateSelection => ({
      entityKeys: candidate!.graph.entities.filter((entity) => !reviewed.has(entityReviewKey(entity.key)) && verdicts.get(entityReviewKey(entity.key)) === verdict).map((entity) => entity.key),
      relationshipIndexes: candidate!.graph.relationships.flatMap((_, index) => !reviewed.has(relationshipReviewKey(index)) && verdicts.get(relationshipReviewKey(index)) === verdict ? [index] : [])
    });
    const accept = selectionFor("accept");
    if (accept.entityKeys.length + accept.relationshipIndexes.length > 0) {
      try {
        await dependencies.accept(access, candidate.id, "Automatic curation: explicit, useful, source-grounded knowledge (evidence-v2).", accept);
      } catch (error) {
        if (error instanceof AmbiguousKnowledgeIdentityError) {
          await dependencies.candidates.deferIdentityResolution(organizationId, candidate.id, error.entityKeys);
          return curate(organizationId, chunkId, requestedBy);
        }
        if (!(error instanceof KnowledgeOntologyViolationError)) { throw error; }
        // A stricter dictionary changed after assessment; leave these items for a reviewer.
      }
    }
    const ignore = selectionFor("ignore");
    if (ignore.entityKeys.length + ignore.relationshipIndexes.length > 0) {
      await dependencies.reject(access, candidate.id, "Automatic curation: unsupported, incidental, or non-specific knowledge (evidence-v2).", ignore);
    }
  };
}
