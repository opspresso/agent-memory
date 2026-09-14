import type { ProposedKnowledgeGraph } from "./knowledge-candidate";
import { isSymmetricKnowledgePredicate, knowledgeCanonicalNameKey, normalizeKnowledgeKind, normalizeKnowledgePredicate } from "./knowledge-identity";

export interface KnowledgeExtractionExpected {
  readonly entities: readonly { readonly kind: string; readonly name: string }[];
  readonly relationships: readonly { readonly source: string; readonly predicate: string; readonly target: string }[];
  readonly aliases?: Readonly<Record<string, readonly string[]>>;
  readonly surfaceForms?: Readonly<Record<string, readonly string[]>>;
}

export interface ExtractionCounts { readonly truePositive: number; readonly falsePositive: number; readonly falseNegative: number }

export function scoreKnowledgeExtraction(graph: ProposedKnowledgeGraph, expected: KnowledgeExtractionExpected, matchSourceSurfaces = false) {
  const entityKey = (kind: string, name: string) => JSON.stringify([normalizeKnowledgeKind(kind), knowledgeCanonicalNameKey(name)]);
  const expectedEntities = new Set(expected.entities.map((entity) => entityKey(entity.kind, entity.name)));
  const aliasTargets = new Map<string, Set<string>>();
  for (const entity of expected.entities) {
    for (const alias of [...(expected.aliases?.[entity.name] ?? []), ...(matchSourceSurfaces ? expected.surfaceForms?.[entity.name] ?? [] : [])]) {
      const key = entityKey(entity.kind, alias);
      const targets = aliasTargets.get(key) ?? new Set<string>();
      targets.add(entityKey(entity.kind, entity.name));
      aliasTargets.set(key, targets);
    }
  }
  const identity = (kind: string, name: string) => {
    const key = entityKey(kind, name), aliases = aliasTargets.get(key);
    return expectedEntities.has(key) || aliases?.size !== 1 ? key : [...aliases][0]!;
  };
  const actualEntities = graph.entities.map((entity) => identity(entity.kind, entity.canonicalName));
  const actualByKey = new Map(graph.entities.map((entity, index) => [entity.key, actualEntities[index]!]));
  const expectedByName = new Map(expected.entities.map((entity) => [knowledgeCanonicalNameKey(entity.name), entityKey(entity.kind, entity.name)]));
  const relationKey = (source: string, predicate: string, target: string) => {
    if (isSymmetricKnowledgePredicate(predicate) && source > target) [source, target] = [target, source];
    return JSON.stringify([source, normalizeKnowledgePredicate(predicate), target]);
  };
  const actualRelations = graph.relationships.map((relation) => relationKey(
    actualByKey.get(relation.sourceKey) ?? `missing:${relation.sourceKey}`, relation.predicate,
    actualByKey.get(relation.targetKey) ?? `missing:${relation.targetKey}`));
  const expectedRelations = new Set(expected.relationships.map((relation) => relationKey(
    expectedByName.get(knowledgeCanonicalNameKey(relation.source)) ?? relation.source, relation.predicate,
    expectedByName.get(knowledgeCanonicalNameKey(relation.target)) ?? relation.target)));
  function counts(actual: readonly string[], wanted: ReadonlySet<string>): ExtractionCounts {
    const unique = new Set(actual);
    const truePositive = [...unique].filter((value) => wanted.has(value)).length;
    return { truePositive, falsePositive: actual.length - truePositive, falseNegative: wanted.size - truePositive };
  }
  const falseMerges = graph.entities.filter((entity) => (entity.aliases ?? []).some((alias) => {
    const aliasKey = entityKey(entity.kind, alias);
    return expectedEntities.has(aliasKey) && aliasKey !== identity(entity.kind, entity.canonicalName);
  })).length;
  const expectedAliases = new Set(expected.entities.flatMap((entity) => (expected.aliases?.[entity.name] ?? [])
    .map((alias) => JSON.stringify([entityKey(entity.kind, entity.name), knowledgeCanonicalNameKey(alias)]))));
  const actualAliases = graph.entities.flatMap((entity) => (entity.aliases ?? [])
    .map((alias) => JSON.stringify([identity(entity.kind, entity.canonicalName), knowledgeCanonicalNameKey(alias)])));
  return { entities: counts(actualEntities, expectedEntities), relationships: counts(actualRelations, expectedRelations),
    aliases: counts(actualAliases, expectedAliases), falseMerges };
}

export function extractionMetrics(counts: ExtractionCounts) {
  const precision = counts.truePositive / (counts.truePositive + counts.falsePositive || 1);
  const recall = counts.truePositive / (counts.truePositive + counts.falseNegative || 1);
  return { ...counts, precision, recall, f1: 2 * precision * recall / (precision + recall || 1) };
}
