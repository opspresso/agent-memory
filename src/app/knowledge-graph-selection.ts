export interface KnowledgeGraphSelection {
  readonly nodeIds: readonly string[];
  readonly multiple: boolean;
}

export const emptyKnowledgeGraphSelection: KnowledgeGraphSelection = { nodeIds: [], multiple: false };

export function selectKnowledgeGraphNode(selection: KnowledgeGraphSelection, nodeId: string, additive = false): KnowledgeGraphSelection {
  if (!additive) return { nodeIds: [nodeId], multiple: false };
  const nodeIds = selection.nodeIds.includes(nodeId)
    ? selection.nodeIds.filter((id) => id !== nodeId)
    : [...selection.nodeIds, nodeId];
  return { nodeIds, multiple: nodeIds.length > 0 };
}

export function inspectKnowledgeGraphNode(selection: KnowledgeGraphSelection, nodeId: string): KnowledgeGraphSelection {
  return selection.nodeIds.includes(nodeId)
    ? { ...selection, nodeIds: [...selection.nodeIds.filter((id) => id !== nodeId), nodeId] }
    : selectKnowledgeGraphNode(selection, nodeId);
}

export function filterSelectedKnowledgeEdges<T extends { readonly sourceNodeId: string; readonly targetNodeId: string }>(edges: readonly T[], selection: KnowledgeGraphSelection): readonly T[] {
  if (!selection.multiple) return edges;
  const ids = new Set(selection.nodeIds);
  return edges.filter((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId));
}
