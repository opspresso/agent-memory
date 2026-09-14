import type { ProposedKnowledgeEntity } from "./knowledge-candidate";
import { normalizeKnowledgeKind, normalizeKnowledgeName } from "./knowledge-identity";

// These describe assertions between entities, never entity identities. This
// invariant applies even when an organization's vocabulary is off or warn.
const assertionKinds = new Set([
  "relationship", "relation", "employment", "statement", "claim", "fact", "attribute"
]);

export function isKnowledgeEntityKind(kind: string): boolean {
  return !assertionKinds.has(normalizeKnowledgeKind(kind));
}

export function knowledgeEntityEligibilityIssue(
  entity: Pick<ProposedKnowledgeEntity, "kind" | "canonicalName">,
  content: string
): "assertion_kind" | "name_not_in_source" | undefined {
  if (!isKnowledgeEntityKind(entity.kind)) return "assertion_kind";
  const name = normalizeKnowledgeName(entity.canonicalName);
  if (!name || !normalizeKnowledgeName(content).includes(name)) return "name_not_in_source";
  return undefined;
}
