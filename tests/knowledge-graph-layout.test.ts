import { describe, expect, it } from "vitest";

import {
  knowledgeNodeDegrees,
  layoutKnowledgeGraph,
  type KnowledgeGraphNodeView
} from "@/app/knowledge-graph";

const nodes: readonly KnowledgeGraphNodeView[] = [
  { id: "center", kind: "service", canonicalName: "Memory API", scope: { kind: "organization", organizationId: "organization-1" } },
  { id: "document", kind: "document", canonicalName: "Runbook", scope: { kind: "organization", organizationId: "organization-1" } },
  { id: "agent", kind: "agent", canonicalName: "Release Agent", scope: { kind: "organization", organizationId: "organization-1" } }
];

describe("knowledge graph layout", () => {
  it("keeps the selected center at the canvas origin and distributes neighbors", () => {
    const layout = layoutKnowledgeGraph(nodes, "center");

    expect(layout[0]).toMatchObject({ id: "center", x: 50, y: 50 });
    expect(layout.slice(1).every((node) => node.x !== 50 || node.y !== 50)).toBe(
      true
    );
  });

  it("produces deterministic positions", () => {
    expect(layoutKnowledgeGraph(nodes, "center")).toEqual(
      layoutKnowledgeGraph(nodes, "center")
    );
  });

  it("places direct and second-degree neighbors on separate orbits", () => {
    const layout = layoutKnowledgeGraph(nodes, "center", [
      { id: "edge-1", sourceNodeId: "center", targetNodeId: "document", predicate: "uses", scope: { kind: "organization", organizationId: "organization-1" } },
      { id: "edge-2", sourceNodeId: "document", targetNodeId: "agent", predicate: "read-by", scope: { kind: "organization", organizationId: "organization-1" } }
    ]);
    const document = layout.find((node) => node.id === "document");
    const agent = layout.find((node) => node.id === "agent");

    expect(Math.hypot((document?.x ?? 50) - 50, (document?.y ?? 50) - 50)).toBeCloseTo(21);
    expect(Math.hypot((agent?.x ?? 50) - 50, (agent?.y ?? 50) - 50)).toBeCloseTo(34);
  });

  it("counts only edges whose endpoints are present", () => {
    expect(
      knowledgeNodeDegrees(nodes, [
        { id: "edge-1", sourceNodeId: "center", targetNodeId: "document", predicate: "uses", scope: { kind: "organization", organizationId: "organization-1" } },
        { id: "edge-2", sourceNodeId: "center", targetNodeId: "missing", predicate: "uses", scope: { kind: "organization", organizationId: "organization-1" } }
      ])
    ).toEqual(new Map([["center", 1], ["document", 1], ["agent", 0]]));
  });
});
