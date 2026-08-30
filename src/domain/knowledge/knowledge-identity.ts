const kindAliases: Readonly<Record<string, string>> = Object.freeze({
  achievement: "recognition",
  award: "recognition",
  designation: "recognition",
  honor: "recognition",
  honour: "recognition"
});

export function normalizeKnowledgeKind(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return kindAliases[normalized] ?? normalized;
}

export function normalizeKnowledgePredicate(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function normalizeKnowledgeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function knowledgeCanonicalNameKey(value: string): string {
  return normalizeKnowledgeName(value).toLowerCase();
}
