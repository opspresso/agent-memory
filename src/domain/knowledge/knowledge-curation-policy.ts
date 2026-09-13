import type { KnowledgeCandidate } from "./knowledge-candidate";
import { InvalidKnowledgeCandidateError } from "./knowledge-candidate";
import { entityReviewKey, relationshipReviewKey } from "./knowledge-candidate-selection";
import type { KnowledgeAliasVerification, KnowledgeCandidateAssessment, KnowledgeItemVerification } from "./knowledge-assessment";
import type { OrganizationKnowledgeOntology } from "./knowledge-ontology-reader";
import { evaluateKnowledgeOntology } from "./knowledge-ontology";

const vague = new Set(["associated_with", "related_to", "related_with", "co_occurs_with"]);
const incidentalMovement = new Set(["comes_from", "went_to", "visits", "visited", "responds_to"]);
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();

export function assessKnowledgeCandidate(input: {
  candidate: KnowledgeCandidate; content: string; model: string; items: readonly KnowledgeItemVerification[];
  aliases?: readonly KnowledgeAliasVerification[];
  now: Date; ontology: OrganizationKnowledgeOntology | null;
}): KnowledgeCandidateAssessment {
  const graph = input.candidate.graph;
  const expected = [...graph.entities.map((entity) => entityReviewKey(entity.key)), ...graph.relationships.map((_, index) => relationshipReviewKey(index))];
  const verifications = new Map(input.items.map((item) => [item.item, item]));
  if (verifications.size !== expected.length || input.items.length !== expected.length || expected.some((key) => !verifications.has(key))) {
    throw new InvalidKnowledgeCandidateError("verification must cover each proposed item exactly once");
  }
  const source = normalize(input.content);
  const proposedAliases = graph.entities.flatMap((entity) => (entity.aliases ?? []).map((alias) => ({ entityKey: entity.key, alias })));
  const aliasKey = (alias: { entityKey: string; alias: string }) => JSON.stringify([alias.entityKey, alias.alias]);
  const aliasVerifications = new Map((input.aliases ?? []).map((alias) => [aliasKey(alias), alias]));
  if (input.aliases && (input.aliases.length !== proposedAliases.length || aliasVerifications.size !== proposedAliases.length
    || proposedAliases.some((alias) => !aliasVerifications.has(aliasKey(alias))))) {
    throw new InvalidKnowledgeCandidateError("alias verification must cover each proposed alias exactly once");
  }
  const aliases: NonNullable<KnowledgeCandidateAssessment["aliases"]> = proposedAliases.map((alias) => {
    const result = aliasVerifications.get(aliasKey(alias)) ?? { ...alias, identity: "uncertain" as const, evidence: "", reason: "Alias identity was not independently verified." };
    const evidence = normalize(result.evidence);
    const grounded = evidence.length > 0 && source.includes(evidence);
    const verdict = result.identity === "generic_reference" || result.identity === "different_entity" ? "ignore"
      : result.identity === "same_entity" && grounded ? "accept" : "review";
    return { ...result, verdict, evidence: grounded ? evidence : "" };
  });
  const items = new Map(expected.map((key) => {
    const result = verifications.get(key)!;
    const evidence = normalize(result.evidence);
    const verdict = result.conflict || result.support === "uncertain" ? "review"
      : result.support === "unsupported" || result.usefulness === "incidental" ? "ignore"
      : evidence && source.includes(evidence) ? "accept" : "review";
    return [key, { item: key, verdict, evidence: evidence && source.includes(evidence) ? evidence : "", reason: result.reason }] as const;
  }));
  const change = (key: string, verdict: "accept" | "review" | "ignore", reason?: string) => {
    const current = items.get(key)!;
    items.set(key, { ...current, verdict, reason: reason ?? current.reason });
  };
  const allowed = (kind?: string, predicate?: string) => input.ontology?.mode !== "strict" ||
    evaluateKnowledgeOntology(input.ontology.ontology, { kinds: kind ? [kind] : [], predicates: predicate ? [predicate] : [] }).length === 0;
  const unresolvedAliases = new Set(graph.relationships.filter((relationship) => relationship.predicate === "alias_of")
    .flatMap((relationship) => [relationship.sourceKey, relationship.targetKey]).concat(aliases.filter((alias) => alias.verdict === "review").map((alias) => alias.entityKey)));
  for (const entity of graph.entities) {
    if (unresolvedAliases.has(entity.key)) {
      change(entityReviewKey(entity.key), "review", "Alias identity needs resolution before creating separate entities.");
    } else if (!allowed(entity.kind) && items.get(entityReviewKey(entity.key))?.verdict === "accept") {
      change(entityReviewKey(entity.key), "review", "The entity kind is outside the strict ontology.");
    }
  }
  graph.relationships.forEach((relationship, index) => {
    const key = relationshipReviewKey(index);
    if (relationship.predicate === "alias_of") { change(key, "review", "Alias identity needs resolution before merging entities."); }
    if (vague.has(relationship.predicate)) { change(key, "ignore", "The relation does not identify a specific fact."); }
    if (incidentalMovement.has(relationship.predicate)) { change(key, "ignore", "An unqualified movement or response in one scene is not a durable relationship. Model a consequential event with its context instead."); }
    if (items.get(key)?.verdict !== "accept") { return; }
    const endpoints = [relationship.sourceKey, relationship.targetKey].map((key) => graph.entities.find((entity) => entity.key === key)!);
    if (!allowed(undefined, relationship.predicate) || endpoints.some((entity) => {
      const result = verifications.get(entityReviewKey(entity.key))!;
      return unresolvedAliases.has(entity.key) || !allowed(entity.kind) || result.support !== "explicit" || result.conflict ||
        !normalize(result.evidence) || !source.includes(normalize(result.evidence));
    })) {
      change(key, "review", "The relation or one of its endpoints needs review.");
    } else {
      endpoints.forEach((entity) => change(entityReviewKey(entity.key), "accept"));
    }
  });
  graph.relationships.forEach((relationship, index) => {
    if (items.get(relationshipReviewKey(index))?.verdict === "ignore") { return; }
    for (const key of [relationship.sourceKey, relationship.targetKey]) {
      if (items.get(entityReviewKey(key))?.verdict === "ignore") {
        change(entityReviewKey(key), "review", "An unresolved relationship still references this entity.");
      }
    }
  });
  return { model: input.model, policyVersion: "evidence-v2", assessedAt: input.now.toISOString(), items: [...items.values()], ...(aliases.length ? { aliases } : {}) };
}
