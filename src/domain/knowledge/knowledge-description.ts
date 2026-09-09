/** A bounded overview; complete descriptions remain attached to their sources. */
export function mergeKnowledgeDescriptions(descriptions: readonly string[]): string | undefined {
  const unique = [...new Set(descriptions.flatMap((value) => value.split(/\n\s*\n/))
    .map((value) => value.normalize("NFKC").trim().replace(/\s+/g, " ")).filter(Boolean))].sort();
  const selected: string[] = [];
  let length = 0;
  for (const description of unique) {
    const nextLength = length + (selected.length ? 2 : 0) + description.length;
    if (nextLength <= 10_000) { selected.push(description); length = nextLength; }
  }
  return selected.length ? selected.join("\n\n") : undefined;
}
