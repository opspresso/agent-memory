import { knowledgeCanonicalNameKey, normalizeKnowledgeKind, normalizeKnowledgeName } from "./knowledge-identity";

export class AmbiguousKnowledgeIdentityError extends Error {
  constructor(readonly entityKeys: readonly string[]) {
    super("Multiple knowledge nodes match this identity. Resolve the existing nodes before accepting it.");
    this.name = "AmbiguousKnowledgeIdentityError";
  }
}

export function knowledgeNameMap(names: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(names.map((name) => [knowledgeCanonicalNameKey(name), normalizeKnowledgeName(name)]));
}

export function knowledgeAliases(canonicalName: string, names: readonly string[]): readonly string[] {
  const canonicalKey = knowledgeCanonicalNameKey(canonicalName);
  return Object.entries(knowledgeNameMap(names)).filter(([key]) => key !== canonicalKey).map(([, name]) => name);
}

export function resolveKnowledgeIdentity<T extends { readonly id: string; readonly kind: string; readonly canonicalName: string;
  readonly aliases: readonly string[]; readonly createdAt: Date }>(
  proposed: { readonly canonicalName: string; readonly kind: string; readonly aliases: readonly string[] },
  existing: readonly T[]
): { readonly status: "new" } | { readonly status: "ambiguous" } | {
  readonly status: "resolved"; readonly target: T; readonly mergeNodeIds: readonly string[];
} {
  const names = Object.keys(knowledgeNameMap([proposed.canonicalName, ...proposed.aliases]));
  const primaryName = knowledgeCanonicalNameKey(proposed.canonicalName);
  const identities = existing.filter((node) => normalizeKnowledgeKind(node.kind) === normalizeKnowledgeKind(proposed.kind))
    .map((node) => ({ node, names: new Set(Object.keys(knowledgeNameMap([node.canonicalName, ...node.aliases]))) }));
  const matching = new Map<string, T>();
  for (const name of names) {
    const nodes = identities.filter((identity) => identity.names.has(name)).map((identity) => identity.node);
    // Two different proper names sharing only a nickname do not establish one identity.
    if (name !== primaryName && !nodes.some((node) => knowledgeCanonicalNameKey(node.canonicalName) === name)) continue;
    // Multiple matches need explicit links to all of their representative names.
    if (nodes.length > 1 && !nodes.every((node) => names.includes(knowledgeCanonicalNameKey(node.canonicalName)))) return { status: "ambiguous" };
    for (const node of nodes) matching.set(node.id, node);
  }
  const nodes = [...matching.values()].toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  if (!nodes[0]) return { status: "new" };
  const target = nodes.find((node) => knowledgeCanonicalNameKey(node.canonicalName) === knowledgeCanonicalNameKey(proposed.canonicalName)) ?? nodes[0];
  return { status: "resolved", target, mergeNodeIds: nodes.filter((node) => node.id !== target.id).map((node) => node.id) };
}
