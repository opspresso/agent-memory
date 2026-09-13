import type { KnowledgeCandidate } from "./knowledge-candidate";
import { InvalidKnowledgeCandidateError } from "./knowledge-candidate";
import { entityReviewKey, relationshipReviewKey } from "./knowledge-candidate-selection";
import type { KnowledgeAliasVerification, KnowledgeCandidateAssessment, KnowledgeItemVerification } from "./knowledge-assessment";
import { currentKnowledgeAssessmentPolicyVersion, limitKnowledgeAssessmentReason } from "./knowledge-assessment";
import type { OrganizationKnowledgeOntology } from "./knowledge-ontology-reader";
import { defaultKnowledgeOntology, evaluateKnowledgeOntology } from "./knowledge-ontology";
import { knowledgeEntityEligibilityIssue } from "./knowledge-entity-eligibility";
import { normalizeKnowledgeKind } from "./knowledge-identity";

const vague = new Set(["associated_with", "related_to", "related_with", "co_occurs_with"]);
const incidentalMovement = new Set(["comes_from", "went_to", "visits", "visited", "responds_to"]);
// Named, source-verified facts in these relations are useful by contract.
// A model's salience opinion must not erase a valid dependency or biography.
const durableRelations = new Set([...defaultKnowledgeOntology.edgePredicates,
  "serves", "student_of", "sworn_sibling_of", "sibling_of", "spouse_of", "lives_in",
  "has_skill", "contributed_to", "received", "runs_on", "attempts_to_kill", "killed", "joins",
  "developed", "built", "created", "authored", "published", "founded"
]);
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim();

export function assessKnowledgeCandidate(input: {
  candidate: KnowledgeCandidate; content: string; model: string; items: readonly KnowledgeItemVerification[];
  aliases?: readonly KnowledgeAliasVerification[];
  now: Date; ontology: OrganizationKnowledgeOntology | null;
}): KnowledgeCandidateAssessment {
  const graph = input.candidate.graph;
  const durableItems = new Set(graph.relationships.flatMap((relationship, index) =>
    durableRelations.has(relationship.predicate) ? [relationshipReviewKey(index)] : []));
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
    const aliasInSource = normalize(alias.alias).length > 0 && source.includes(normalize(alias.alias));
    const verdict = !aliasInSource || result.descriptiveExpansion === true
      || result.identity === "generic_reference" || result.identity === "different_entity" ? "ignore"
      : result.identity === "same_entity" && grounded ? "accept" : "review";
    return { ...result, verdict, evidence: grounded ? evidence : "",
      reason:limitKnowledgeAssessmentReason(aliasInSource ? result.reason : "The proposed alias does not occur in the source.") };
  });
  const items = new Map(expected.map((key) => {
    const result = verifications.get(key)!;
    const evidence = normalize(result.evidence);
    const verdict = result.conflict || result.support === "uncertain" ? "review"
      : result.support === "unsupported" || (result.usefulness === "incidental" && !durableItems.has(key)) ? "ignore"
      : evidence && source.includes(evidence) ? "accept" : "review";
    return [key, { item: key, representation:result.representation, ...(result.entityKind?{ entityKind:normalizeKnowledgeKind(result.entityKind) }:{}),
      support: result.support, usefulness: result.usefulness, conflict: result.conflict,
      verdict, evidence: evidence && source.includes(evidence) ? evidence : "",
      reason: limitKnowledgeAssessmentReason(verdict === "accept" && result.usefulness === "incidental"
        ? `The explicit, source-grounded relation is retained despite the verifier's incidental label. ${result.reason}` : result.reason) }] as const;
  }));
  const change = (key: string, verdict: "accept" | "review" | "ignore", reason?: string) => {
    const current = items.get(key)!;
    items.set(key, { ...current, verdict, reason: reason ?? current.reason });
  };
  const allowed = (kind?: string, predicate?: string) => input.ontology?.mode !== "strict" ||
    evaluateKnowledgeOntology(input.ontology.ontology, { kinds: kind ? [kind] : [], predicates: predicate ? [predicate] : [] }).length === 0;
  const unresolvedAliases = new Set(graph.relationships.filter((relationship) => relationship.predicate === "alias_of")
    .flatMap((relationship) => [relationship.sourceKey, relationship.targetKey]).concat(aliases.filter((alias) => alias.verdict === "review").map((alias) => alias.entityKey)));
  const ineligibleEntities = new Set<string>();
  const kindMatches = (key: string,kind: string) => normalizeKnowledgeKind(verifications.get(entityReviewKey(key))?.entityKind??"") === normalizeKnowledgeKind(kind);
  for (const entity of graph.entities) {
    const issue = knowledgeEntityEligibilityIssue(entity, input.content);
    const representation = verifications.get(entityReviewKey(entity.key))!.representation;
    if (issue || (representation && representation !== "entity" && representation !== "uncertain")) {
      ineligibleEntities.add(entity.key);
      change(entityReviewKey(entity.key), "ignore", issue === "name_not_in_source"
        ? "The proposed entity name does not occur in the source."
        : "The proposed item is a reference or assertion, not an independent named entity.");
    } else if (representation !== "entity") {
      change(entityReviewKey(entity.key), "review", "Independent entity representation has not been established.");
    } else if (!kindMatches(entity.key,entity.kind)) {
      change(entityReviewKey(entity.key), "review", "Independent source verification did not confirm the proposed entity kind.");
    } else if (unresolvedAliases.has(entity.key)) {
      change(entityReviewKey(entity.key), "review", "Alias identity needs resolution before creating separate entities.");
    } else if (!allowed(entity.kind) && items.get(entityReviewKey(entity.key))?.verdict === "accept") {
      change(entityReviewKey(entity.key), "review", "The entity kind is outside the strict ontology.");
    }
  }
  graph.relationships.forEach((relationship, index) => {
    const key = relationshipReviewKey(index);
    if (ineligibleEntities.has(relationship.sourceKey) || ineligibleEntities.has(relationship.targetKey)) {
      change(key, "ignore", "The relationship references an ineligible entity.");
      return;
    }
    const representation = verifications.get(key)!.representation;
    if (representation !== "relationship") {
      change(key, !representation || representation === "uncertain" ? "review" : "ignore", "The proposed item is not a verified relationship representation.");
    }
    if (relationship.predicate === "alias_of") { change(key, "review", "Alias identity needs resolution before merging entities."); }
    if (vague.has(relationship.predicate)) { change(key, "ignore", "The relation does not identify a specific fact."); }
    if (incidentalMovement.has(relationship.predicate)) { change(key, "ignore", "An unqualified movement or response in one scene is not a durable relationship. Model a consequential event with its context instead."); }
    if (items.get(key)?.verdict !== "accept") { return; }
    const endpoints = [relationship.sourceKey, relationship.targetKey].map((key) => graph.entities.find((entity) => entity.key === key)!);
    if (!allowed(undefined, relationship.predicate) || endpoints.some((entity) => {
      const result = verifications.get(entityReviewKey(entity.key))!;
      return unresolvedAliases.has(entity.key) || !allowed(entity.kind) || !kindMatches(entity.key,entity.kind) || result.representation !== "entity" || result.support !== "explicit" || result.conflict ||
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
  return { model: input.model, policyVersion: currentKnowledgeAssessmentPolicyVersion, assessedAt: input.now.toISOString(), items: [...items.values()], ...(aliases.length ? { aliases } : {}) };
}
