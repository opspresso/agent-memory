import { describe, expect, it } from "vitest";
import { planKnowledgeScopeChange, type ScopeChangeResource, type ScopeChangeEdge } from "@/domain/knowledge/knowledge-scope-change";
import type { OrganizationAccess, ScopedResource } from "@/domain/identity/organization-access";

const access: OrganizationAccess = { organizationId: "org", userId: "owner", role: "owner", teams: [] };
const organization: ScopedResource = { kind: "organization", organizationId: "org" };
const user: ScopedResource = { kind: "user", organizationId: "org", userId: "owner" };
const node = (id: string, overrides: Partial<ScopeChangeResource> = {}): ScopeChangeResource => ({ id, scope: user, affected: true, ...overrides });
const edge = (overrides: Partial<ScopeChangeEdge> = {}): ScopeChangeEdge => ({ ...node("edge"), sourceNodeId: "a", targetNodeId: "b", ...overrides });

describe("knowledge scope change planning", () => {
  it("changes verified nodes and their relation together", () => {
    const plan = planKnowledgeScopeChange({ access, target: organization, nodes: [node("a"), node("b")], edges: [edge()] });
    expect(plan.nodeIds).toEqual(["a", "b"]);
    expect(plan.edgeIds).toEqual(["edge"]);
    expect(plan.summary.skipped).toEqual([]);
  });

  it.each(["source_scope", "source_unavailable"] as const)("keeps a node with %s and its dependent edge private", (sourceIssue) => {
    const plan = planKnowledgeScopeChange({ access, target: organization, nodes: [node("a", { sourceIssue }), node("b")], edges: [edge()] });
    expect(plan.nodeIds).toEqual(["b"]);
    expect(plan.edgeIds).toEqual([]);
    expect(plan.summary.skipped).toEqual([
      { resource: "node", reason: sourceIssue, count: 1 }, { resource: "edge", reason: "endpoint_scope", count: 1 }
    ]);
  });

  it("does not narrow shared nodes while an unrelated organization edge remains", () => {
    const plan = planKnowledgeScopeChange({ access, target: user, nodes: [node("a", { scope: organization }), node("b", { scope: organization })], edges: [edge({ scope: organization, affected: false })] });
    expect(plan.nodeIds).toEqual([]);
    expect(plan.summary.skipped).toEqual([{ resource: "node", reason: "connected_edge", count: 2 }]);
  });

  it("narrows nodes and affected edges together", () => {
    const plan = planKnowledgeScopeChange({ access, target: user, nodes: [node("a", { scope: organization }), node("b", { scope: organization })], edges: [edge({ scope: organization })] });
    expect(plan.nodeIds).toEqual(["a", "b"]);
    expect(plan.edgeIds).toEqual(["edge"]);
  });

  it("skips inaccessible and conflicting nodes, without exposing their IDs in the summary", () => {
    const plan = planKnowledgeScopeChange({ access, target: organization, nodes: [node("secret", { scope: { ...user, userId: "other" } }), node("duplicate", { identityConflict: true })], edges: [] });
    expect(plan.nodeIds).toEqual([]);
    expect(plan.summary.nodes.skipped).toBe(2);
    expect(JSON.stringify(plan.summary)).not.toMatch(/secret|duplicate/);
  });

  it("requires a currently visible source at both edge endpoints", () => {
    const plan = planKnowledgeScopeChange({ access, target: organization, nodes: [node("a", { scope: organization, affected: false, visibleAtTarget: false }), node("b")], edges: [edge()] });
    expect(plan.edgeIds).toEqual([]);
  });

  it("leaves unrelated resources alone and counts already matching resources", () => {
    const plan = planKnowledgeScopeChange({ access, target: organization, nodes: [node("same", { scope: organization }), node("unrelated", { affected: false })], edges: [] });
    expect(plan.summary.nodes).toEqual({ updated: 0, unchanged: 1, skipped: 0 });
  });
});
