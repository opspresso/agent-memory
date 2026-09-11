import { canAccessScopedResource, type OrganizationAccess, type ScopedResource } from "../identity/organization-access";
import { sameScope, scopeCovers } from "../identity/scope-coverage";
import type { KnowledgeScopeChangeSummary, KnowledgeScopeSkipReason } from "../document/document-scope-change";

export class KnowledgeScopeChangedError extends Error {
  constructor() { super("Knowledge source scope changed; reload before retrying"); this.name = "KnowledgeScopeChangedError"; }
}

export interface ScopeChangeResource {
  readonly id: string;
  readonly scope: ScopedResource;
  readonly affected: boolean;
  readonly sourceIssue?: "source_scope" | "source_unavailable";
  readonly identityConflict?: boolean;
  readonly visibleAtTarget?: boolean;
}
export interface ScopeChangeEdge extends ScopeChangeResource {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}

export function planKnowledgeScopeChange(input: {
  readonly access: OrganizationAccess;
  readonly target: ScopedResource;
  readonly nodes: readonly ScopeChangeResource[];
  readonly edges: readonly ScopeChangeEdge[];
}) {
  const { access, target, nodes, edges } = input;
  const nodeChanges = new Set<string>();
  const edgeChanges = new Set<string>();
  const nodeSkips = new Map<string, KnowledgeScopeSkipReason>();
  const edgeSkips = new Map<string, KnowledgeScopeSkipReason>();
  function select(resources: readonly ScopeChangeResource[], changes: Set<string>, skips: Map<string, KnowledgeScopeSkipReason>) {
    for (const resource of resources) {
      if (!resource.affected || sameScope(resource.scope, target)) continue;
      const reason = !canAccessScopedResource(access, "manage", resource.scope)
        ? "access_denied" : resource.sourceIssue ?? (resource.identityConflict ? "identity_conflict" : undefined);
      if (reason) skips.set(resource.id, reason);
      else changes.add(resource.id);
    }
  }
  select(nodes, nodeChanges, nodeSkips);
  select(edges, edgeChanges, edgeSkips);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const finalNodeScope = (id: string) => nodeChanges.has(id) ? target : nodeById.get(id)?.scope;

  // Removing a node change can invalidate an edge change, and vice versa.
  // Iterate to a fixed point so scope narrowing cannot strand existing edges.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const source = finalNodeScope(edge.sourceNodeId);
      const destination = finalNodeScope(edge.targetNodeId);
      if (edgeChanges.has(edge.id) && (!source || !destination || !scopeCovers(source, target) || !scopeCovers(destination, target) || nodeById.get(edge.sourceNodeId)?.visibleAtTarget === false || nodeById.get(edge.targetNodeId)?.visibleAtTarget === false)) {
        edgeChanges.delete(edge.id);
        edgeSkips.set(edge.id, "endpoint_scope");
        changed = true;
      }
      const edgeScope = edgeChanges.has(edge.id) ? target : edge.scope;
      for (const id of [edge.sourceNodeId, edge.targetNodeId]) {
        if (nodeChanges.has(id) && !scopeCovers(target, edgeScope)) {
          nodeChanges.delete(id);
          nodeSkips.set(id, "connected_edge");
          changed = true;
        }
      }
    }
  }
  const counts = (resources: readonly ScopeChangeResource[], changes: Set<string>, skips: Map<string, KnowledgeScopeSkipReason>) => ({
    updated: changes.size,
    unchanged: resources.filter((resource) => resource.affected && sameScope(resource.scope, target)).length,
    skipped: skips.size
  });
  const skipped: KnowledgeScopeChangeSummary["skipped"][number][] = [];
  for (const [resource, skips] of [["node", nodeSkips], ["edge", edgeSkips]] as const) {
    const reasons = new Map<KnowledgeScopeSkipReason, number>();
    for (const reason of skips.values()) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    for (const [reason, count] of reasons) skipped.push({ resource, reason, count });
  }
  return {
    nodeIds: [...nodeChanges], edgeIds: [...edgeChanges],
    summary: { nodes: counts(nodes, nodeChanges, nodeSkips), edges: counts(edges, edgeChanges, edgeSkips), skipped } satisfies KnowledgeScopeChangeSummary
  };
}
