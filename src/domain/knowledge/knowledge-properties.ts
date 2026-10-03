import type { KnowledgeSource } from "./knowledge-graph";

export interface KnowledgePropertyContribution extends KnowledgeSource {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly updatedAt: Date;
}

/** Later visible contributions override keys; source identity breaks timestamp ties. */
export function mergeKnowledgeProperties(contributions: readonly KnowledgePropertyContribution[]): Readonly<Record<string, unknown>> {
  const sourceKey = (source: KnowledgeSource) => source.memoryId ? `memory:${source.memoryId}` : `chunk:${source.chunkId}`;
  const ordered = contributions.toSorted((left, right) => {
    const elapsed = left.updatedAt.getTime() - right.updatedAt.getTime();
    if (elapsed) return elapsed;
    const leftKey = sourceKey(left), rightKey = sourceKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Object.freeze(Object.fromEntries(ordered.flatMap((source) => Object.entries(source.properties))));
}
