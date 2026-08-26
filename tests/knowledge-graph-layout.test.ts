import { describe, expect, it } from "vitest";

import {
  layoutKnowledgeGraph,
  type KnowledgeGraphNodeView
} from "@/app/knowledge-graph";

const nodes: readonly KnowledgeGraphNodeView[] = [
  { id: "center", kind: "service", canonicalName: "Memory API" },
  { id: "document", kind: "document", canonicalName: "Runbook" },
  { id: "agent", kind: "agent", canonicalName: "Release Agent" }
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
});
