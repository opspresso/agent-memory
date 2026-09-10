import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import type { ScopedResource } from "@/domain/identity/organization-access";

export interface KnowledgeGraphNodeView {
  readonly id: string;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
  readonly scope: ScopedResource;
  readonly sources?: readonly { readonly memoryId?: string; readonly chunkId?: string }[];
}
export interface KnowledgeGraphEdgeView {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly predicate: string;
  readonly scope: ScopedResource;
  readonly sources?: readonly { readonly memoryId?: string; readonly chunkId?: string }[];
}
export interface GraphParticle extends SimulationNodeDatum {
  readonly id: string;
  readonly radius: number;
}
export interface GraphLink extends SimulationLinkDatum<GraphParticle> {
  readonly id: string;
  readonly lane: number;
}
export interface KnowledgeGraphLayoutCache {
  readonly center: string;
  readonly particles: GraphParticle[];
  readonly topology: string;
  readonly alpha: number;
}
export function knowledgeNodeDegrees(nodes: readonly KnowledgeGraphNodeView[], edges: readonly KnowledgeGraphEdgeView[]): ReadonlyMap<string, number> {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (degrees.has(edge.sourceNodeId) && degrees.has(edge.targetNodeId)) {
      degrees.set(edge.sourceNodeId, (degrees.get(edge.sourceNodeId) ?? 0) + 1);
      degrees.set(edge.targetNodeId, (degrees.get(edge.targetNodeId) ?? 0) + 1);
    }
  }
  return degrees;
}
export function graphNodeRadius(degree: number, center: boolean) { return (center ? 20 : 12) + Math.min(degree, 12) * 0.6; }

export function createKnowledgeGraphSimulation(nodes: readonly KnowledgeGraphNodeView[], edges: readonly KnowledgeGraphEdgeView[], centerNodeId: string, cached?: KnowledgeGraphLayoutCache | null, anchorNodeId = centerNodeId) {
  const degrees = knowledgeNodeDegrees(nodes, edges);
  // D3 mutates simulation objects; never give it application data or source refs.
  const particles: GraphParticle[] = nodes.map((node) => ({ id: node.id, radius: graphNodeRadius(degrees.get(node.id) ?? 0, node.id === centerNodeId),
    ...(node.id === centerNodeId ? { fx: 0, fy: 0, x: 0, y: 0 } : {}) }));
  const hasCachedLayout = cached?.center === centerNodeId && cached.particles.length > 0;
  if (hasCachedLayout) {
    const previous = new Map(cached.particles.map((node) => [node.id, node]));
    for (const node of particles) {
      const old = previous.get(node.id);
      if (old) Object.assign(node, { x: old.x, y: old.y, vx: old.vx, vy: old.vy, fx: old.fx, fy: old.fy });
    }
    const positioned = new Map(previous);
    const pending = particles.filter((node) => !previous.has(node.id));
    const neighbors = new Map(particles.map((node) => [node.id, [] as string[]]));
    for (const edge of edges) {
      neighbors.get(edge.sourceNodeId)?.push(edge.targetNodeId);
      neighbors.get(edge.targetNodeId)?.push(edge.sourceNodeId);
    }
    while (pending.length > 0) {
      const connectedIndex = pending.findIndex((node) => neighbors.get(node.id)?.some((id) => positioned.has(id)));
      const node = pending.splice(Math.max(0, connectedIndex), 1)[0]!;
      const neighborId = neighbors.get(node.id)?.find((id) => positioned.has(id));
      const anchor = positioned.get(neighborId ?? anchorNodeId) ?? positioned.get(anchorNodeId) ?? positioned.get(centerNodeId);
      const originX = anchor?.x ?? 0, originY = anchor?.y ?? 0;
      // A golden-angle spiral seeds each new branch without piling nodes on top of existing ones.
      const phase = [...node.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
      for (let attempt = 0; attempt < 256; attempt++) {
        const angle = phase + attempt * Math.PI * (3 - Math.sqrt(5));
        const distance = 110 + 18 * Math.sqrt(attempt);
        node.x = originX + Math.cos(angle) * distance;
        node.y = originY + Math.sin(angle) * distance;
        if ([...positioned.values()].every((other) => Math.hypot(node.x! - (other.x ?? 0), node.y! - (other.y ?? 0)) >= node.radius + other.radius + 48)) break;
      }
      positioned.set(node.id, node);
    }
  }
  const ids = new Set(particles.map((node) => node.id));
  const pairs = new Map<string, KnowledgeGraphEdgeView[]>();
  for (const edge of edges) {
    if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId)) { continue; }
    const key = JSON.stringify([edge.sourceNodeId, edge.targetNodeId].sort());
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  }
  const links: GraphLink[] = [...pairs.values()].flatMap((pair) => pair.toSorted((a, b) => a.id.localeCompare(b.id)).map((edge, index) => ({
    id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId,
    lane: (index - (pair.length - 1) / 2) * (edge.sourceNodeId < edge.targetNodeId ? 1 : -1)
  })));
  const topology = JSON.stringify([
    particles.map((node) => JSON.stringify([node.id, node.radius])).sort(),
    links.map((link) => JSON.stringify([link.id, link.source, link.target])).sort()
  ]);
  const simulation = forceSimulation(particles).stop()
    .alpha(hasCachedLayout ? Math.max(cached.alpha, cached.topology === topology ? 0 : 0.22) : 1)
    .force("link", forceLink<GraphParticle, GraphLink>(links).id((node) => node.id).distance(140).strength(0.35))
    .force("charge", forceManyBody<GraphParticle>().strength(-420))
    .force("collision", forceCollide<GraphParticle>().radius((node) => node.radius + 32).iterations(2))
    .force("x", forceX(0).strength(0.035)).force("y", forceY(0).strength(0.035));
  return { simulation, particles, links, topology, hasCachedLayout };
}
export function graphEdgeGeometry(link: GraphLink) {
  const source = link.source as GraphParticle, target = link.target as GraphParticle;
  const dx = (target.x ?? 0) - (source.x ?? 0), dy = (target.y ?? 0) - (source.y ?? 0);
  const length = Math.max(Math.hypot(dx, dy), 1);
  const sx = (source.x ?? 0) + dx / length * (source.radius + 3), sy = (source.y ?? 0) + dy / length * (source.radius + 3);
  const tx = (target.x ?? 0) - dx / length * (target.radius + 9), ty = (target.y ?? 0) - dy / length * (target.radius + 9);
  const bend = link.lane * 48;
  const cx = (sx + tx) / 2 - dy / length * bend, cy = (sy + ty) / 2 + dx / length * bend;
  return { path: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`, x: (sx + 2 * cx + tx) / 4 - dy / length * 28, y: (sy + 2 * cy + ty) / 4 + dx / length * 28 };
}

export function mergeGraphParticles(previous: readonly GraphParticle[], current: readonly GraphParticle[], allowedIds: ReadonlySet<string>): GraphParticle[] {
  const positions = new Map(previous.filter((node) => allowedIds.has(node.id)).map((node) => [node.id, node]));
  for (const node of current) { if (allowedIds.has(node.id)) { positions.set(node.id, node); } }
  return [...positions.values()];
}

export function fitKnowledgeGraph(particles: readonly GraphParticle[], width: number, height: number) {
  if (!particles.length || width <= 40 || height <= 170) { return null; }
  const left = Math.min(...particles.map((node) => (node.x ?? 0) - node.radius - 80));
  const right = Math.max(...particles.map((node) => (node.x ?? 0) + node.radius + 80));
  const top = Math.min(...particles.map((node) => (node.y ?? 0) - node.radius - 25));
  const bottom = Math.max(...particles.map((node) => (node.y ?? 0) + node.radius + 45));
  const k = Math.min(1.4, (width - 40) / Math.max(right - left, 1), (height - 170) / Math.max(bottom - top, 1));
  return { k, x: width / 2 - k * (left + right) / 2, y: height / 2 + 5 - k * (top + bottom) / 2 };
}

export function mergeKnowledgeGraphItems<T extends { readonly id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  return [...new Map([...current, ...incoming].map((item) => [item.id, item])).values()];
}
