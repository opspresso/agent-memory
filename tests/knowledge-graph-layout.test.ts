import { describe, expect, it } from "vitest";
import { createKnowledgeGraphSimulation, fitKnowledgeGraph, mergeGraphParticles, graphEdgeGeometry, knowledgeNodeDegrees, type KnowledgeGraphNodeView } from "@/app/knowledge-graph-layout";

const scope = { kind: "organization" as const, organizationId: "org" };
const nodes: readonly KnowledgeGraphNodeView[] = ["center", "document", "agent"].map((id) => Object.freeze({ id, kind: "concept", canonicalName: id, scope }));
const edge = (id: string, sourceNodeId: string, targetNodeId: string) => Object.freeze({ id, sourceNodeId, targetNodeId, predicate: "uses", scope });

describe("D3 knowledge graph layout", () => {
  it("settles without overlapping nodes or mutating application data", () => {
    const edges = Object.freeze([edge("1", "center", "document"), edge("2", "document", "agent")]);
    const before = JSON.stringify({ nodes, edges });
    const { simulation, particles } = createKnowledgeGraphSimulation(nodes, edges, "center");
    simulation.tick(300);
    expect(particles[0]).toMatchObject({ id: "center", x: 0, y: 0 });
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i]!, b = particles[j]!;
        expect(Math.hypot(a.x! - b.x!, a.y! - b.y!)).toBeGreaterThan(a.radius + b.radius);
      }
    }
    expect(JSON.stringify({ nodes, edges })).toBe(before);
  });
  it("produces finite deterministic positions and excludes missing endpoints", () => {
    const calculate = () => {
      const { simulation, particles, links } = createKnowledgeGraphSimulation(nodes, [edge("bad", "center", "missing")], "center");
      simulation.tick(200);
      expect(links).toHaveLength(0);
      expect(particles.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
      return particles.map(({ x, y }) => ({ x, y }));
    };
    expect(calculate()).toEqual(calculate());
    expect(knowledgeNodeDegrees(nodes, [edge("1", "center", "agent"), edge("2", "center", "missing")])).toEqual(new Map([["center", 1], ["document", 0], ["agent", 1]]));
  });
  it("separates parallel and reverse relationships into distinct lanes", () => {
    const { simulation, links } = createKnowledgeGraphSimulation(nodes, [edge("1", "center", "agent"), edge("2", "agent", "center"), edge("3", "center", "agent")], "center");
    simulation.tick(200);
    const geometries = links.map(graphEdgeGeometry);
    expect(new Set(geometries.map(({ x, y }) => `${x.toFixed(1)}:${y.toFixed(1)}`)).size).toBe(3);
    expect(geometries.every(({ path }) => !path.includes("NaN"))).toBe(true);
  });
  it("supports empty neighborhoods", () => {
    const { simulation, particles, links } = createKnowledgeGraphSimulation([], [], "missing");
    simulation.tick(1);
    expect(particles).toEqual([]); expect(links).toEqual([]);
  });
  it("preserves hidden pins while removing nodes no longer in the neighborhood", () => {
    const hidden = { id: "hidden", radius: 12, x: 120, y: 45, fx: 120, fy: 45 };
    const removed = { id: "removed", radius: 12 };
    const current = { id: "visible", radius: 12, x: 20, y: 30 };
    const merged = mergeGraphParticles([hidden, removed], [current], new Set(["hidden", "visible"]));
    expect(merged).toEqual([hidden, current]);
    expect(mergeGraphParticles([], [current], new Set(["hidden", "visible"]))).toEqual([current]);
  });
  it("fits distant pinned nodes below the ordinary zoom-out limit", () => {
    const particles = [{ id: "a", radius: 20, x: -10_000, y: -10_000 }, { id: "b", radius: 20, x: 10_000, y: 10_000 }];
    const fit = fitKnowledgeGraph(particles, 600, 500)!;
    expect(fit.k).toBeLessThan(0.2);
    for (const node of particles) {
      expect(fit.x + fit.k * (node.x - node.radius - 80)).toBeGreaterThanOrEqual(20);
      expect(fit.x + fit.k * (node.x + node.radius + 80)).toBeLessThanOrEqual(580);
      expect(fit.y + fit.k * (node.y - node.radius - 25)).toBeGreaterThanOrEqual(85);
      expect(fit.y + fit.k * (node.y + node.radius + 45)).toBeLessThanOrEqual(425);
    }
    expect(fitKnowledgeGraph(particles, 0, 0)).toBeNull();
    expect(fitKnowledgeGraph([], 600, 500)).toBeNull();
  });

});
