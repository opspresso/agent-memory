import type { KnowledgeCandidate, KnowledgeCandidateSelection } from "./knowledge-candidate";
import { entityReviewKey, relationshipReviewKey } from "./knowledge-candidate-selection";
import { knowledgeCanonicalNameKey, normalizeKnowledgeKind, normalizeKnowledgePredicate } from "./knowledge-identity";

export interface KnowledgeReviewSource {
  readonly candidate: KnowledgeCandidate;
  readonly documentTitle: string;
  readonly ordinal: number;
}

export interface KnowledgeReviewOccurrence {
  readonly candidateId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly chunkId: string;
  readonly ordinal: number;
  readonly selection: KnowledgeCandidateSelection;
  readonly evidence: readonly string[];
  readonly summary?: string;
  readonly aliases: readonly string[];
}

export interface KnowledgeReviewGroup {
  readonly key: string;
  readonly kind: "entity" | "relationship";
  readonly title: string;
  readonly predicate?: string;
  readonly entityKind?: string;
  readonly scope: KnowledgeCandidate["scope"];
  readonly occurrences: readonly KnowledgeReviewOccurrence[];
  readonly evidenceCount: number;
  readonly documentCount: number;
  readonly weak: boolean;
}

const symmetric = new Set(["spouse_of", "sibling_of", "sworn_sibling_of"]);
const vague = new Set(["associated_with", "related_to", "related_with", "co_occurs_with"]);

export function groupKnowledgeReviewSources(sources: readonly KnowledgeReviewSource[]): readonly KnowledgeReviewGroup[] {
  const groups = new Map<string, KnowledgeReviewGroup>();
  for (const { candidate, documentTitle, ordinal } of sources) {
    const scope = candidate.scope;
    const scopeKey = [scope.organizationId, scope.kind, scope.kind === "team" ? scope.teamId : scope.kind === "user" ? scope.userId : ""];
    const reviewed = new Set(candidate.itemReviews?.map((review) => review.item));
    const entities = new Map(candidate.graph.entities.map((entity) => [entity.key, entity]));
    const identity = (key: string) => {
      const entity = entities.get(key)!;
      return JSON.stringify([normalizeKnowledgeKind(entity.kind), knowledgeCanonicalNameKey(entity.canonicalName)]);
    };
    const add = (group: Omit<KnowledgeReviewGroup, "occurrences" | "evidenceCount" | "documentCount" | "scope">,
      selection: KnowledgeCandidateSelection, evidence: readonly string[] = [], summary?: string, aliases: readonly string[] = []) => {
      const occurrence: KnowledgeReviewOccurrence = {
        candidateId: candidate.id, documentId: candidate.documentId, documentTitle,
        chunkId: candidate.chunkId, ordinal, selection, evidence, aliases,
        ...(summary ? { summary } : {})
      };
      const existing = groups.get(group.key);
      groups.set(group.key, { ...group, scope, evidenceCount: 0, documentCount: 0,
        occurrences: [...(existing?.occurrences ?? []), occurrence] });
    };
    for (const entity of candidate.graph.entities) {
      if (reviewed.has(entityReviewKey(entity.key))) { continue; }
      add({ key: JSON.stringify([...scopeKey, "entity", identity(entity.key)]), kind: "entity",
        title: entity.canonicalName, entityKind: normalizeKnowledgeKind(entity.kind), weak: false },
      { entityKeys: [entity.key], relationshipIndexes: [] }, entity.evidence, entity.summary, entity.aliases);
    }
    candidate.graph.relationships.forEach((relationship, index) => {
      if (reviewed.has(relationshipReviewKey(index))) { return; }
      const source = entities.get(relationship.sourceKey);
      const target = entities.get(relationship.targetKey);
      if (!source || !target) { return; }
      const predicate = normalizeKnowledgePredicate(relationship.predicate);
      const endpoints = [identity(source.key), identity(target.key)];
      if (symmetric.has(predicate)) { endpoints.sort(); }
      add({ key: JSON.stringify([...scopeKey, "relationship", ...endpoints, predicate]), kind: "relationship",
        title: `${source.canonicalName} → ${predicate} → ${target.canonicalName}`, predicate,
        weak: vague.has(predicate) },
      { entityKeys: [], relationshipIndexes: [index] }, relationship.evidence);
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    evidenceCount: new Set(group.occurrences.flatMap((occurrence) => occurrence.evidence.map((quote) => quote.normalize("NFKC").replace(/\s+/g, " ").trim()))).size,
    documentCount: new Set(group.occurrences.map((occurrence) => occurrence.documentId)).size
  })).sort((a, b) => Number(a.weak) - Number(b.weak)
    || Number(b.evidenceCount > 0) - Number(a.evidenceCount > 0)
    || Number(b.kind === "relationship") - Number(a.kind === "relationship")
    || b.documentCount - a.documentCount
    || a.key.localeCompare(b.key));
}
