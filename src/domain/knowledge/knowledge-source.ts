export interface KnowledgeSource {
  readonly memoryId?: string;
  readonly chunkId?: string;
}

export function uniqueKnowledgeSources(sources: readonly KnowledgeSource[]): readonly KnowledgeSource[] {
  const unique = new Map<string, KnowledgeSource>();
  for (const source of sources) {
    if (Number(source.memoryId !== undefined) + Number(source.chunkId !== undefined) !== 1 ||
        (source.memoryId !== undefined && !source.memoryId.trim()) ||
        (source.chunkId !== undefined && !source.chunkId.trim())) throw new Error("knowledge provenance must reference exactly one non-empty source ID");
    const normalized = source.memoryId !== undefined ? { memoryId: source.memoryId } : { chunkId: source.chunkId! };
    unique.set(JSON.stringify(normalized), Object.freeze(normalized));
  }
  return Object.freeze([...unique.values()]);
}
