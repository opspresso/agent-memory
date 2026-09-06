"use client";

import { Accordion, ActionIcon, Badge, Button, Group, Paper, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconFocusCentered, IconMinus, IconPlus, IconRoute, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMemo, useState, type CSSProperties } from "react";

import type { ScopedResource } from "@/domain/identity/organization-access";

import { useT } from "./_i18n/provider";
import classes from "./knowledge-graph.module.css";
import { SourceEvidence } from "./source-evidence";

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

interface PositionedNode extends KnowledgeGraphNodeView {
  readonly x: number;
  readonly y: number;
}

interface PositionedEdge {
  readonly labelX: number;
  readonly labelY: number;
  readonly path: string;
}

interface KnowledgeGraphProps {
  readonly canDeleteEdge: (edge: KnowledgeGraphEdgeView) => boolean;
  readonly canDeleteNode: (node: KnowledgeGraphNodeView) => boolean;
  readonly centerNodeId: string;
  readonly deletingResource: boolean;
  readonly edges: readonly KnowledgeGraphEdgeView[];
  readonly nodes: readonly KnowledgeGraphNodeView[];
  readonly onExploreNode: (nodeId: string) => void;
  readonly onDeleteEdge: (edge: KnowledgeGraphEdgeView) => void;
  readonly onDeleteNode: (node: KnowledgeGraphNodeView) => void;
  readonly onSelectNode: (nodeId: string) => void;
  readonly selectedNodeId: string;
}

const NODE_COLORS = ["#6675ff", "#16a085", "#d97757", "#a56de2", "#d4a72c", "#3282b8"];

function kindColor(kind: string) {
  const hash = [...kind].reduce((value, character) => value + character.charCodeAt(0), 0);
  return NODE_COLORS[hash % NODE_COLORS.length];
}

export function knowledgeNodeDegrees(
  nodes: readonly KnowledgeGraphNodeView[],
  edges: readonly KnowledgeGraphEdgeView[]
): ReadonlyMap<string, number> {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (degrees.has(edge.sourceNodeId) && degrees.has(edge.targetNodeId)) {
      degrees.set(edge.sourceNodeId, (degrees.get(edge.sourceNodeId) ?? 0) + 1);
      degrees.set(edge.targetNodeId, (degrees.get(edge.targetNodeId) ?? 0) + 1);
    }
  }
  return degrees;
}

export function layoutKnowledgeGraph(
  nodes: readonly KnowledgeGraphNodeView[],
  centerNodeId: string,
  edges: readonly KnowledgeGraphEdgeView[] = []
): readonly PositionedNode[] {
  const center = nodes.find((node) => node.id === centerNodeId);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue;
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  }
  const distances = new Map<string, number>([[centerNodeId, 0]]);
  const queue = [centerNodeId];
  for (const nodeId of queue) {
    const distance = distances.get(nodeId) ?? 0;
    for (const neighborId of adjacency.get(nodeId) ?? []) {
      if (distances.has(neighborId)) continue;
      distances.set(neighborId, distance + 1);
      queue.push(neighborId);
    }
  }
  const surrounding = nodes
    .filter((node) => node.id !== centerNodeId)
    .toSorted((left, right) => {
      const distance = (distances.get(left.id) ?? 3) - (distances.get(right.id) ?? 3);
      return distance || left.kind.localeCompare(right.kind) || left.canonicalName.localeCompare(right.canonicalName) || left.id.localeCompare(right.id);
    });
  const rings = new Map<number, KnowledgeGraphNodeView[]>();
  for (const node of surrounding) {
    const ring = Math.min(distances.get(node.id) ?? 3, 3);
    rings.set(ring, [...(rings.get(ring) ?? []), node]);
  }
  const positioned = [...rings.entries()].flatMap(([ring, ringNodes]) => ringNodes.map((node, index) => {
    const angle = (index / Math.max(ringNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const baseRadius = ring === 1 ? 21 : ring === 2 ? 34 : 41;
    const radius = baseRadius + (ringNodes.length > 12 && index % 2 === 1 ? 3 : 0);
    return { ...node, x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
  }));
  return center ? [{ ...center, x: 50, y: 50 }, ...positioned] : positioned;
}

function positionedEdge(source: PositionedNode, target: PositionedNode, edgeId: string): PositionedEdge {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const startX = source.x + (dx / length) * 5.8;
  const startY = source.y + (dy / length) * 5.8;
  const endX = target.x - (dx / length) * 5.8;
  const endY = target.y - (dy / length) * 5.8;
  const direction = [...edgeId].reduce((value, character) => value + character.charCodeAt(0), 0) % 2 === 0 ? 1 : -1;
  const bend = Math.min(length * 0.12, 4.5) * direction;
  const controlX = (startX + endX) / 2 - (dy / length) * bend;
  const controlY = (startY + endY) / 2 + (dx / length) * bend;
  return {
    path: `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`,
    labelX: (startX + 2 * controlX + endX) / 4,
    labelY: (startY + 2 * controlY + endY) / 4
  };
}

function clippedLabel(value: string) {
  return value.length > 20 ? `${value.slice(0, 19)}…` : value;
}

export function KnowledgeGraph({ canDeleteEdge, canDeleteNode, centerNodeId, deletingResource, edges, nodes, onDeleteEdge, onDeleteNode, onExploreNode, onSelectNode, selectedNodeId }: KnowledgeGraphProps) {
  const t = useT();
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const kinds = useMemo(() => [...new Set(nodes.map((node) => node.kind))].sort(), [nodes]);
  const visibleNodes = nodes.filter((node) => node.id === centerNodeId || !hiddenKinds.has(node.kind));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId));
  const positionedNodes = layoutKnowledgeGraph(visibleNodes, centerNodeId, visibleEdges);
  const positions = new Map(positionedNodes.map((node) => [node.id, node]));
  const degrees = knowledgeNodeDegrees(visibleNodes, visibleEdges);
  const selectedNode = positionedNodes.find((node) => node.id === selectedNodeId) ?? positionedNodes[0];
  const selectedEdges = selectedNode
    ? visibleEdges.filter((edge) => edge.sourceNodeId === selectedNode.id || edge.targetNodeId === selectedNode.id)
    : [];
  const neighborIds = new Set(selectedEdges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingIds = new Set(normalizedQuery
    ? visibleNodes.filter((node) => `${node.canonicalName} ${node.kind}`.toLocaleLowerCase().includes(normalizedQuery)).map((node) => node.id)
    : []);
  const kindCounts = new Map(kinds.map((kind) => [kind, nodes.filter((node) => node.kind === kind).length]));
  const viewSize = 100 / zoom;
  const viewOffset = (100 - viewSize) / 2;

  function toggleKind(kind: string) {
    setHiddenKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  return (
    <section aria-label={t("graph.mapLabel")} className={classes.explorer}>
      <div className={classes.canvas}>
        <div className={classes.toolbar}>
          <TextInput aria-label={t("graph.searchLabel")} className={classes.search} leftSection={<IconSearch size={15} />} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("graph.searchPlaceholder")} size="xs" value={query} />
          <Group gap={4} wrap="nowrap">
            <Tooltip label={t("graph.zoomOut")}><ActionIcon aria-label={t("graph.zoomOut")} disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))} variant="default"><IconMinus size={15} /></ActionIcon></Tooltip>
            <Text className={classes.zoomValue} ff="monospace" size="xs">{Math.round(zoom * 100)}%</Text>
            <Tooltip label={t("graph.zoomIn")}><ActionIcon aria-label={t("graph.zoomIn")} disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))} variant="default"><IconPlus size={15} /></ActionIcon></Tooltip>
            <Tooltip label={t("graph.fit")}><ActionIcon aria-label={t("graph.fit")} onClick={() => setZoom(1)} variant="default"><IconFocusCentered size={15} /></ActionIcon></Tooltip>
          </Group>
        </div>
        <svg aria-label={t("graph.summary", { nodes: visibleNodes.length, edges: visibleEdges.length })} className={classes.graph} role="group" viewBox={`${viewOffset} ${viewOffset} ${viewSize} ${viewSize}`}>
          <defs>
            <marker id="graph-arrow" markerHeight="5" markerWidth="5" orient="auto" refX="4" refY="2.5"><path className={classes.arrow} d="M 0 0 L 5 2.5 L 0 5 z" /></marker>
            <radialGradient id="graph-center-glow"><stop offset="0" stopColor="#a78bfa" stopOpacity=".22" /><stop offset="1" stopColor="#a78bfa" stopOpacity="0" /></radialGradient>
          </defs>
          <circle className={classes.centerGlow} cx="50" cy="50" fill="url(#graph-center-glow)" r="24" />
          <circle className={classes.orbit} cx="50" cy="50" r="21" />
          <circle className={classes.orbit} cx="50" cy="50" r="34" />
          {visibleEdges.map((edge) => {
            const source = positions.get(edge.sourceNodeId);
            const target = positions.get(edge.targetNodeId);
            if (!source || !target) return null;
            const isActive = !selectedNode || selectedEdges.some((item) => item.id === edge.id);
            const geometry = positionedEdge(source, target, edge.id);
            return <g data-muted={!isActive || undefined} key={edge.id}>
              <path className={classes.edge} d={geometry.path} markerEnd="url(#graph-arrow)" />
              <text className={classes.edgeLabel} x={geometry.labelX} y={geometry.labelY - 1.4}>{clippedLabel(edge.predicate)}</text>
            </g>;
          })}
          {positionedNodes.map((node) => {
            const isCenter = node.id === centerNodeId;
            const isSelected = node.id === selectedNode?.id;
            const isMuted = normalizedQuery ? !matchingIds.has(node.id) : Boolean(selectedNode && node.id !== selectedNode.id && !neighborIds.has(node.id));
            const radius =
              (isCenter ? 5.3 : 4.1) +
              Math.min(degrees.get(node.id) ?? 0, 6) * 0.18;
            return <g aria-label={`${node.kind.toUpperCase()} ${node.canonicalName}`} aria-pressed={isSelected} className={classes.node} data-center={isCenter || undefined} data-muted={isMuted || undefined} data-search-match={matchingIds.has(node.id) || undefined} data-selected={isSelected || undefined} key={node.id} onClick={() => onSelectNode(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectNode(node.id); } }} role="button" style={{ "--node-accent": kindColor(node.kind) } as CSSProperties} tabIndex={0} transform={`translate(${node.x} ${node.y})`}>
              <circle className={classes.nodeAura} r={radius + 2.3} />
              <circle className={classes.nodeRing} r={radius + 0.8} />
              <circle className={classes.nodeCore} r={radius} />
              <text className={classes.nodeKind} textAnchor="middle" y="-0.8">{node.kind.toUpperCase()}</text>
              <text className={classes.nodeLabel} textAnchor="middle" y="2.5">{clippedLabel(node.canonicalName)}</text>
            </g>;
          })}
        </svg>
        <div aria-label={t("graph.kindFilter")} className={classes.legend} role="group">
          {kinds.map((kind) => <button aria-pressed={!hiddenKinds.has(kind)} className={classes.kindChip} data-disabled={hiddenKinds.has(kind) || undefined} key={kind} onClick={() => toggleKind(kind)} style={{ "--node-accent": kindColor(kind) } as CSSProperties} type="button"><span />{kind}<strong>{kindCounts.get(kind)}</strong></button>)}
        </div>
      </div>
      <Paper className={classes.inspector} p="md" radius="lg">
        <details className={classes.nodeList} open>
          <summary>{t("evidence.nodeList", { count: normalizedQuery ? matchingIds.size : visibleNodes.length })}</summary>
          <Stack gap={4} mt="sm">
            {visibleNodes.filter((node) => !normalizedQuery || matchingIds.has(node.id)).map((node) => <button type="button" className={classes.listItem} aria-pressed={node.id === selectedNode?.id} key={node.id} onClick={() => onSelectNode(node.id)}><strong>{node.canonicalName}</strong><span>{node.kind}</span></button>)}
            {normalizedQuery && matchingIds.size === 0 ? <Text size="sm" c="dimmed">{t("evidence.noNodes")}</Text> : null}
          </Stack>
        </details>
        {selectedNode ? <Stack gap="md">
          <Stack gap={4}><Group justify="space-between"><Badge color="gray" size="xs" variant="light">{selectedNode.kind}</Badge><Text c="dimmed" ff="monospace" size="xs">{t("graph.relations", { count: degrees.get(selectedNode.id) ?? 0 })}</Text></Group><Title order={4}>{selectedNode.canonicalName}</Title></Stack>
          <Badge variant="light">{t(`workspace.scope.${selectedNode.scope.kind}`)}</Badge>
          <Text c="dimmed" size="sm">{selectedNode.summary ?? t("graph.noSummary")}</Text>
          <Stack gap="xs"><Text c="dimmed" fw={700} size="xs" tt="uppercase">{t("graph.connectedBy")}</Text>
            {selectedEdges.length > 0 ? selectedEdges.map((edge) => {
              const isOutgoing = edge.sourceNodeId === selectedNode.id;
              const related = positions.get(isOutgoing ? edge.targetNodeId : edge.sourceNodeId);
              return <div key={edge.id}><div className={classes.relationRow}><button className={classes.relation} onClick={() => related && onSelectNode(related.id)} type="button"><IconRoute aria-hidden size={14} /><span>{isOutgoing ? "→" : "←"} {edge.predicate}</span><strong>{related?.canonicalName}</strong></button>{canDeleteEdge(edge) ? <Tooltip label={t("graph.deleteEdge")}><ActionIcon aria-label={t("graph.deleteEdge")} color="red" disabled={deletingResource} onClick={() => onDeleteEdge(edge)} variant="subtle"><IconTrash size={14} /></ActionIcon></Tooltip> : null}</div>{(edge.sources?.length ?? 0) > 0 ? <Accordion variant="contained"><Accordion.Item value="sources"><Accordion.Control>{t("evidence.sources", { count: edge.sources?.length ?? 0 })}</Accordion.Control><Accordion.Panel><Stack>{edge.sources?.map((source, index) => <SourceEvidence key={`${source.memoryId ?? source.chunkId}:${index}`} {...source} />)}</Stack></Accordion.Panel></Accordion.Item></Accordion> : null}</div>;
            }) : <Text c="dimmed" size="sm">{t("graph.noRelations")}</Text>}
          </Stack>
          {(selectedNode.sources?.length ?? 0) > 0 ? <Accordion variant="contained" key={selectedNode.id}><Accordion.Item value="sources"><Accordion.Control>{t("evidence.sources", { count: selectedNode.sources?.length ?? 0 })}</Accordion.Control><Accordion.Panel><Stack>{selectedNode.sources?.map((source, index) => <SourceEvidence key={`${source.memoryId ?? source.chunkId}:${index}`} {...source} />)}</Stack></Accordion.Panel></Accordion.Item></Accordion> : null}
          {selectedNode.id !== centerNodeId ? <Button leftSection={<IconFocusCentered size={15} />} onClick={() => onExploreNode(selectedNode.id)} size="compact-sm" variant="light">{t("graph.exploreFromNode")}</Button> : null}
          {canDeleteNode(selectedNode) ? <Button color="red" disabled={deletingResource} leftSection={<IconTrash size={15} />} onClick={() => onDeleteNode(selectedNode)} size="compact-sm" variant="subtle">{t("graph.deleteNode")}</Button> : null}
        </Stack> : null}
      </Paper>
    </section>
  );
}
