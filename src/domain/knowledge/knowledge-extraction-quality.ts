import type {
  ProposedKnowledgeEntity,
  ProposedKnowledgeGraph,
  ProposedKnowledgeRelationship
} from "./knowledge-candidate";
import {
  knowledgeCanonicalNameKey,
  normalizeKnowledgeKind,
  normalizeKnowledgeName,
  normalizeKnowledgePredicate
} from "./knowledge-identity";

const vaguePredicates = new Set(["associated_with", "related_to", "related_with", "co_occurs_with"]);
const symmetricPredicates = new Set(["spouse_of", "sibling_of", "sworn_sibling_of"]);

function evidenceText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function union(left: readonly string[] = [], right: readonly string[] = []) {
  return [...new Set([...left, ...right])].slice(0, 20);
}

/** Verify quoted spans, not semantic entailment; a reviewer still decides truth. */
export function groundKnowledgeGraph(content: string, graph: ProposedKnowledgeGraph): ProposedKnowledgeGraph {
  const source = evidenceText(content);
  const evidenceFor = (quotes: readonly string[] = []) => quotes
    .map(evidenceText)
    .filter((quote) => quote.length > 0 && source.includes(quote));
  const entities = graph.entities.flatMap((entity) => {
    const evidence = evidenceFor(entity.evidence);
    return evidence.length ? [{ ...entity, evidence }] : [];
  });
  const keys = new Set(entities.map((entity) => entity.key));
  const relationships = graph.relationships.flatMap((relationship) => {
    const evidence = evidenceFor(relationship.evidence);
    return evidence.length && keys.has(relationship.sourceKey) && keys.has(relationship.targetKey)
      && !vaguePredicates.has(normalizeKnowledgePredicate(relationship.predicate))
      ? [{ ...relationship, evidence }]
      : [];
  });
  return consolidateKnowledgeGraph({ entities, relationships });
}

/** Exact identities only: aliases are preserved for review, never fuzzy-merged. */
export function consolidateKnowledgeGraph(graph: ProposedKnowledgeGraph): ProposedKnowledgeGraph {
  const identitiesByKey = new Map<string, string>();
  const ambiguousKeys = new Set<string>();
  const identityFor = (entity: ProposedKnowledgeEntity) => JSON.stringify([
    normalizeKnowledgeKind(entity.kind), knowledgeCanonicalNameKey(entity.canonicalName)
  ]);
  for (const entity of graph.entities) {
    const identity = identityFor(entity);
    const existing = identitiesByKey.get(entity.key);
    if (existing !== undefined && existing !== identity) { ambiguousKeys.add(entity.key); }
    identitiesByKey.set(entity.key, identity);
  }
  const entities = new Map<string, ProposedKnowledgeEntity>();
  const keys = new Map<string, string>();
  for (const entity of graph.entities) {
    // A reused key cannot identify a relationship endpoint without guessing.
    if (ambiguousKeys.has(entity.key)) { continue; }
    const kind = normalizeKnowledgeKind(entity.kind);
    const canonicalName = normalizeKnowledgeName(entity.canonicalName);
    const identity = JSON.stringify([kind, knowledgeCanonicalNameKey(canonicalName)]);
    const existing = entities.get(identity);
    keys.set(entity.key, existing?.key ?? entity.key);
    entities.set(identity, existing ? {
      ...existing,
      // Distinct summaries are retained instead of allowing last-write-wins loss.
      summary: [...new Set([existing.summary, entity.summary].filter(Boolean))].join("\n").slice(0, 10_000) || undefined,
      aliases: union(existing.aliases, entity.aliases),
      evidence: union(existing.evidence, entity.evidence)
    } : { ...entity, kind, canonicalName });
  }
  const relationships = new Map<string, ProposedKnowledgeRelationship>();
  for (const relationship of graph.relationships) {
    let sourceKey = keys.get(relationship.sourceKey);
    let targetKey = keys.get(relationship.targetKey);
    const predicate = normalizeKnowledgePredicate(relationship.predicate);
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      continue;
    }
    if (symmetricPredicates.has(predicate) && sourceKey > targetKey) {
      [sourceKey, targetKey] = [targetKey, sourceKey];
    }
    const identity = JSON.stringify([sourceKey, predicate, targetKey]);
    const existing = relationships.get(identity);
    relationships.set(identity, {
      ...relationship, sourceKey, targetKey, predicate,
      ...(existing ? { evidence: union(existing.evidence, relationship.evidence) } : {})
    });
  }
  return { entities: [...entities.values()], relationships: [...relationships.values()] };
}
