import { describe, expect, it } from "vitest";

import { emptyKnowledgeGraphSelection, filterSelectedKnowledgeEdges, inspectKnowledgeGraphNode, selectKnowledgeGraphNode } from "@/app/knowledge-graph-selection";

describe("knowledge graph selection", () => {
  const edges = [
    { id: "ab", sourceNodeId: "a", targetNodeId: "b" },
    { id: "ba", sourceNodeId: "b", targetNodeId: "a" },
    { id: "bc", sourceNodeId: "b", targetNodeId: "c" }
  ];

  it("shows only relationships whose endpoints are both selected in additive mode", () => {
    const first = selectKnowledgeGraphNode(emptyKnowledgeGraphSelection, "a");
    const pair = selectKnowledgeGraphNode(first, "b", true);
    expect(first).toEqual({ nodeIds: ["a"], multiple: false });
    expect(filterSelectedKnowledgeEdges(edges, pair)).toEqual(edges.slice(0, 2));
    const disconnected = selectKnowledgeGraphNode(selectKnowledgeGraphNode(pair, "c", true), "b", true);
    expect(disconnected.nodeIds).toEqual(["a", "c"]);
    expect(filterSelectedKnowledgeEdges(edges, disconnected)).toEqual([]);
  });

  it("keeps additive filtering for one remaining node and restores all edges when cleared", () => {
    const first = selectKnowledgeGraphNode(emptyKnowledgeGraphSelection, "a", true);
    expect(filterSelectedKnowledgeEdges(edges, first)).toEqual([]);
    const cleared = selectKnowledgeGraphNode(first, "a", true);
    expect(cleared).toEqual(emptyKnowledgeGraphSelection);
    expect(filterSelectedKnowledgeEdges(edges, cleared)).toEqual(edges);
    const single = selectKnowledgeGraphNode(first, "b");
    expect(single).toEqual({ nodeIds: ["b"], multiple: false });
    expect(filterSelectedKnowledgeEdges(edges, single)).toEqual(edges);
  });

  it("preserves multi-selection when inspecting an already selected node", () => {
    const selection = { nodeIds: Object.freeze(["a", "b"]), multiple: true };
    expect(inspectKnowledgeGraphNode(selection, "a")).toEqual({ nodeIds: ["b", "a"], multiple: true });
    expect(selection.nodeIds).toEqual(["a", "b"]);
    expect(inspectKnowledgeGraphNode(selection, "c")).toEqual({ nodeIds: ["c"], multiple: false });
  });
});
