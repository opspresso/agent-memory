import {
  InvalidKnowledgeCandidateError,
  type KnowledgeCandidate,
  type KnowledgeCandidateItemReview,
  type KnowledgeCandidateSelection
} from "./knowledge-candidate";

export function entityReviewKey(key: string) { return `entity:${key}`; }
export function relationshipReviewKey(index: number) { return `relationship:${index}`; }

export function selectKnowledgeCandidateItems(
  candidate: KnowledgeCandidate,
  selection?: KnowledgeCandidateSelection,
  decision: "accepted" | "rejected" = "accepted"
) {
  const reviews = new Map((candidate.itemReviews ?? []).map((review) => [review.item, review.decision]));
  const graph = candidate.graph;
  const entityKeys = new Set(selection?.entityKeys ?? graph.entities.map((entity) => entity.key));
  const indexes = new Set(selection?.relationshipIndexes ?? graph.relationships.map((_, index) => index));
  if ([...entityKeys].some((key) => !graph.entities.some((entity) => entity.key === key)) ||
    [...indexes].some((index) => !Number.isInteger(index) || index < 0 || index >= graph.relationships.length)) {
    throw new InvalidKnowledgeCandidateError("review selection references an unknown item");
  }
  if (selection && entityKeys.size + indexes.size === 0) {
    throw new InvalidKnowledgeCandidateError("review selection must not be empty");
  }
  for (const key of entityKeys) {
    const prior = reviews.get(entityReviewKey(key));
    if (selection && prior && prior !== decision) {
      throw new InvalidKnowledgeCandidateError("selected entity has an opposite review decision");
    }
  }
  graph.relationships.forEach((relationship, index) => {
    if (decision === "rejected" &&
      (entityKeys.has(relationship.sourceKey) || entityKeys.has(relationship.targetKey)) &&
      !reviews.has(relationshipReviewKey(index))) {
      indexes.add(index);
    }
    if (!indexes.has(index)) { return; }
    const prior = reviews.get(relationshipReviewKey(index));
    if (selection && prior && prior !== decision) {
      throw new InvalidKnowledgeCandidateError("selected relationship has an opposite review decision");
    }
    if (decision === "accepted" && !prior) {
      for (const key of [relationship.sourceKey, relationship.targetKey]) {
        if (reviews.get(entityReviewKey(key)) === "rejected") {
          throw new InvalidKnowledgeCandidateError("relationship endpoint was rejected");
        }
        entityKeys.add(key);
      }
    }
  });
  const relationshipIndexes = [...indexes].filter((index) => !reviews.has(relationshipReviewKey(index)));
  const relationships = relationshipIndexes.map((index) => graph.relationships[index]!);
  const requiredEndpoints = decision === "accepted"
    ? new Set(relationships.flatMap((relationship) => [relationship.sourceKey, relationship.targetKey]))
    : new Set<string>();
  const entities = graph.entities.filter((entity) =>
    (entityKeys.has(entity.key) && !reviews.has(entityReviewKey(entity.key))) || requiredEndpoints.has(entity.key));
  const items = [
    ...entities.filter((entity) => !reviews.has(entityReviewKey(entity.key))).map((entity) => entityReviewKey(entity.key)),
    ...relationshipIndexes.map(relationshipReviewKey)
  ];
  return { graph: { entities, relationships }, items, relationshipIndexes };
}

export function reviewedCandidateState(candidate: KnowledgeCandidate, additions: readonly KnowledgeCandidateItemReview[]) {
  const itemReviews = [...(candidate.itemReviews ?? []), ...additions];
  const complete = itemReviews.length === candidate.graph.entities.length + candidate.graph.relationships.length;
  const status = complete
    ? itemReviews.some((review) => review.decision === "accepted") ? "accepted" : "rejected"
    : "pending";
  return { itemReviews, status } as const;
}
