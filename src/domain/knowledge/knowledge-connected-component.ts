import type { KnowledgeNeighborhood } from "./knowledge-graph-repository";

/** Revalidate reachability after filtering provenance at the end of a read. */
export function connectedKnowledgeNeighborhood(graph: KnowledgeNeighborhood, rootId: string): KnowledgeNeighborhood {
  if (!graph.nodes.some((node) => node.id === rootId)) return { nodes: [], edges: [] };
  const neighbors = new Map<string, string[]>();
  for (const edge of graph.edges) {
    neighbors.set(edge.sourceNodeId, [...(neighbors.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
    neighbors.set(edge.targetNodeId, [...(neighbors.get(edge.targetNodeId) ?? []), edge.sourceNodeId]);
  }
  const reached = new Set([rootId]);
  const frontier = [rootId];
  for (let index = 0; index < frontier.length; index++) {
    for (const neighbor of neighbors.get(frontier[index]!) ?? []) {
      if (!reached.has(neighbor)) { reached.add(neighbor); frontier.push(neighbor); }
    }
  }
  return {
    nodes: graph.nodes.filter((node) => reached.has(node.id)),
    edges: graph.edges.filter((edge) => reached.has(edge.sourceNodeId) && reached.has(edge.targetNodeId))
  };
}
