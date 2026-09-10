"use client";

import { ActionIcon, Group, Menu, Text, Tooltip } from "@mantine/core";
import { IconFocusCentered, IconMinus, IconPlus, IconRefresh, IconMaximize, IconMinimize, IconPinnedOff } from "@tabler/icons-react";
import { drag, type D3DragEvent } from "d3-drag";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type D3ZoomEvent } from "d3-zoom";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react";
import { useT } from "./_i18n/provider";
import { createKnowledgeGraphSimulation, fitKnowledgeGraph, mergeGraphParticles, graphEdgeGeometry, graphNodeRadius, knowledgeNodeDegrees, type GraphParticle, type KnowledgeGraphEdgeView, type KnowledgeGraphNodeView } from "./knowledge-graph-layout";
import classes from "./knowledge-graph.module.css";

const colors = ["#6675ff", "#16a085", "#d97757", "#a56de2", "#d4a72c", "#3282b8"];
export function graphKindColor(kind: string) { return colors[[...kind].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % colors.length]; }
const label = (value: string) => value.length > 24 ? `${value.slice(0, 23)}…` : value;

export function KnowledgeGraphCanvas({ nodes, edges, centerNodeId, selectedNodeIds, multipleSelection, displayedEdgeIds, matchingIds, queryActive, onSelectNode, onClearSelection, renderNode, fullscreen, onToggleFullscreen, layoutCache, allowedNodeIds }: {
  readonly allowedNodeIds: ReadonlySet<string>;
  readonly layoutCache: RefObject<{ center: string; particles: GraphParticle[] } | null>;
  readonly fullscreen: boolean;
  readonly onToggleFullscreen: () => void;
  readonly nodes: readonly KnowledgeGraphNodeView[];
  readonly edges: readonly KnowledgeGraphEdgeView[];
  readonly centerNodeId: string;
  readonly selectedNodeIds: ReadonlySet<string>;
  readonly multipleSelection: boolean;
  readonly displayedEdgeIds: ReadonlySet<string>;
  readonly matchingIds: ReadonlySet<string>;
  readonly queryActive: boolean;
  readonly renderNode: (node: KnowledgeGraphNodeView, element: ReactElement, pinAction: ReactNode) => ReactNode;
  readonly onSelectNode: (id: string, additive?: boolean) => void;
  readonly onClearSelection: () => void;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<SVGGElement>(null);
  const controls = useRef<{ scale: (factor: number) => void; fit: () => void; reset: () => void; unpin: (nodeId: string) => void } | null>(null);
  const [pinnedNodeIds, setPinnedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const [scale, setScale] = useState(1);
  const [minimumScale, setMinimumScale] = useState(0.2);
  const arrowId = `graph-arrow-${useId().replaceAll(":", "")}`;
  const degrees = knowledgeNodeDegrees(nodes, edges);
  const related = new Set(edges.filter((edge) => selectedNodeIds.has(edge.sourceNodeId) || selectedNodeIds.has(edge.targetNodeId)).flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));

  useEffect(() => {
    const svgElement = svgRef.current, layerElement = layerRef.current;
    if (!svgElement || !layerElement) { return; }
    const svg = select(svgElement), layer = select(layerElement);
    const { simulation, particles, links } = createKnowledgeGraphSimulation(nodes, edges, centerNodeId);
    const cached = layoutCache.current;
    if (cached?.center === centerNodeId) {
      const previous = new Map(cached.particles.map((node) => [node.id, node]));
      for (const node of particles) {
        const old = previous.get(node.id);
        if (old) { node.x = old.x; node.y = old.y; node.fx = old.fx; node.fy = old.fy; }
      }
    }
    const byId = new Map(particles.map((node) => [node.id, node]));
    const byEdge = new Map(links.map((edge) => [edge.id, edge]));
    const nodeElements = layer.selectAll<SVGGElement, GraphParticle>("[data-node-id]").datum(function () { return byId.get(this.dataset.nodeId!)!; });
    const edgeElements = layer.selectAll<SVGGElement, unknown>("[data-edge-id]");
    function syncPinnedNodes() {
      setPinnedNodeIds(new Set(particles.filter((node) => node.fx != null || node.fy != null).map((node) => node.id)));
    }
    function render() {
      nodeElements.attr("transform", (node) => `translate(${node.x ?? 0},${node.y ?? 0})`).attr("data-pinned", (node) => node.fx != null ? "true" : null);
      edgeElements.each(function () {
        const link = byEdge.get(this.dataset.edgeId!);
        if (!link) { return; }
        const geometry = graphEdgeGeometry(link);
        select(this).select("path").attr("d", geometry.path);
        select(this).select("text").attr("x", geometry.x).attr("y", geometry.y - 7);
      });
    }
    const behavior = zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4])
      .extent((): [[number, number], [number, number]] => [[0, 0], [svgElement.clientWidth, svgElement.clientHeight]])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        layer.attr("transform", event.transform.toString());
        setScale(event.transform.k);
      });
    svg.call(behavior).on("dblclick.zoom", null);
    function fit() {
      const transform = fitKnowledgeGraph(particles, svgElement!.clientWidth, svgElement!.clientHeight);
      if (!transform) { return; }
      const minimum = Math.min(0.2, transform.k);
      behavior.scaleExtent([minimum, 4]);
      setMinimumScale(minimum);
      svg.call(behavior.transform, zoomIdentity.translate(transform.x, transform.y).scale(transform.k));
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    simulation.tick(reducedMotion ? 240 : 100);
    render();
    syncPinnedNodes();
    fit();
    simulation.on("tick", render);
    if (!reducedMotion) { simulation.alpha(0.15).restart(); }
    nodeElements.call(drag<SVGGElement, GraphParticle>().container(() => layerElement).clickDistance(4)
      .on("start", (event: D3DragEvent<SVGGElement, GraphParticle, GraphParticle>, node) => {
        if (!event.active && !reducedMotion) { simulation.alphaTarget(0.15).restart(); }
        node.fx = node.x; node.fy = node.y;
        render(); syncPinnedNodes();
      }).on("drag", (event: D3DragEvent<SVGGElement, GraphParticle, GraphParticle>, node) => {
        node.fx = node.x = event.x; node.fy = node.y = event.y; render();
      }).on("end", (event: D3DragEvent<SVGGElement, GraphParticle, GraphParticle>) => {
        if (!event.active) { simulation.alphaTarget(0); }
      }));
    const observer = new ResizeObserver(fit);
    observer.observe(svgElement);
    controls.current = {
      fit,
      scale: (factor) => svg.call(behavior.scaleBy, factor),
      unpin: (nodeId) => {
        const node = byId.get(nodeId);
        if (!node) return;
        node.fx = null; node.fy = null;
        syncPinnedNodes();
        simulation.alpha(0.5);
        if (reducedMotion) simulation.stop().tick(240);
        else simulation.restart();
        render();
      },
      reset: () => {
        layoutCache.current = null;
        for (const node of particles) { node.fx = node.id === centerNodeId ? 0 : null; node.fy = node.id === centerNodeId ? 0 : null; }
        simulation.alpha(1).stop().tick(240); render(); fit();
        syncPinnedNodes();
      }
    };
    return () => {
      simulation.stop();
      const previous = layoutCache.current?.center === centerNodeId ? layoutCache.current.particles : [];
      layoutCache.current = { center: centerNodeId, particles: mergeGraphParticles(previous, particles, allowedNodeIds) };
      observer.disconnect(); nodeElements.on(".drag", null); svg.on(".zoom", null); controls.current = null;
    };
  }, [nodes, edges, centerNodeId, layoutCache, allowedNodeIds]);

  return <>
    <div className={classes.controls}><Group gap={4} wrap="nowrap">
      <Tooltip label={t("graph.zoomOut")}><ActionIcon aria-label={t("graph.zoomOut")} disabled={scale <= minimumScale} onClick={() => controls.current?.scale(0.8)} variant="default"><IconMinus size={15} /></ActionIcon></Tooltip>
      <Text className={classes.zoomValue} ff="monospace" size="xs">{Math.round(scale * 100)}%</Text>
      <Tooltip label={t("graph.zoomIn")}><ActionIcon aria-label={t("graph.zoomIn")} disabled={scale >= 4} onClick={() => controls.current?.scale(1.25)} variant="default"><IconPlus size={15} /></ActionIcon></Tooltip>
      <Tooltip label={t("graph.fit")}><ActionIcon aria-label={t("graph.fit")} onClick={() => controls.current?.fit()} variant="default"><IconFocusCentered size={15} /></ActionIcon></Tooltip>
      <Tooltip label={t("graph.resetLayout")}><ActionIcon aria-label={t("graph.resetLayout")} onClick={() => controls.current?.reset()} variant="default"><IconRefresh size={15} /></ActionIcon></Tooltip>
      <Tooltip label={t(fullscreen ? "graph.exitFullscreen" : "graph.fullscreen")}><ActionIcon data-fullscreen-toggle aria-label={t(fullscreen ? "graph.exitFullscreen" : "graph.fullscreen")} onClick={onToggleFullscreen} variant="default">{fullscreen ? <IconMinimize size={15} /> : <IconMaximize size={15} />}</ActionIcon></Tooltip>
    </Group></div>
    <svg ref={svgRef} className={classes.graph} role="group" aria-label={t("graph.summary", { nodes: nodes.length, edges: displayedEdgeIds.size })}
      onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }}>
      <defs><marker id={arrowId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path className={classes.arrow} d="M0,0 L7,3.5 L0,7 Z" /></marker></defs>
      <g ref={layerRef} data-graph-layer>
        {edges.map((edge) => {
          const active = selectedNodeIds.has(edge.sourceNodeId) || selectedNodeIds.has(edge.targetNodeId);
          return <g key={edge.id} data-edge-id={edge.id} display={displayedEdgeIds.has(edge.id) ? undefined : "none"} data-muted={selectedNodeIds.size > 0 && !active || undefined} data-active={active || undefined}>
            <path className={classes.edge} markerEnd={`url(#${arrowId})`} />
            <text className={classes.edgeLabel} style={{ opacity: active || edges.length < 16 ? 1 : 0 }}>{label(edge.predicate)}</text>
          </g>;
        })}
        {nodes.map((node) => {
          const radius = graphNodeRadius(degrees.get(node.id) ?? 0, node.id === centerNodeId);
          const muted = queryActive ? !matchingIds.has(node.id) : Boolean(selectedNodeIds.size > 0 && !selectedNodeIds.has(node.id) && (multipleSelection || !related.has(node.id)));
          const pinAction = pinnedNodeIds.has(node.id)
            ? <Menu.Item leftSection={<IconPinnedOff size={15} />} onClick={() => controls.current?.unpin(node.id)}>{t("graph.unpinNode")}</Menu.Item>
            : null;
          return renderNode(node, <g key={node.id} data-node-id={node.id} className={classes.node} data-muted={muted || undefined} data-center={node.id === centerNodeId || undefined} data-selected={selectedNodeIds.has(node.id) || undefined} data-search-match={matchingIds.has(node.id) || undefined}
            role="button" aria-haspopup="menu" tabIndex={0} aria-label={`${node.kind.toUpperCase()} ${node.canonicalName}`} aria-pressed={selectedNodeIds.has(node.id)}
            style={{ "--node-accent": graphKindColor(node.kind) } as CSSProperties} onClick={(event) => onSelectNode(node.id, event.ctrlKey || event.metaKey)}
            onContextMenu={(event) => { if (event.ctrlKey) { event.preventDefault(); onSelectNode(node.id, true); } }}
            onKeyDown={(event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 }));
            } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectNode(node.id, event.ctrlKey || event.metaKey); } }}>
            <title>{`${node.canonicalName} · ${node.kind}`}</title>
            <circle className={classes.nodeAura} r={radius + 9} /><circle className={classes.nodeRing} r={radius + 4} /><circle className={classes.nodeCore} r={radius} />
            <text className={classes.nodeLabel} textAnchor="middle" y={radius + 19}>{label(node.canonicalName)}</text>
          </g>, pinAction);
        })}
      </g>
    </svg>
    <Text className={classes.gestureHint} size="xs">{t("graph.gestureHint")}</Text>
  </>;
}
