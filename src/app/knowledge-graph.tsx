"use client";

import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconFocusCentered, IconMinus, IconPlus, IconRoute, IconSearch } from "@tabler/icons-react";
import { useMemo, useState, type CSSProperties } from "react";

import classes from "./knowledge-graph.module.css";

export interface KnowledgeGraphNodeView {
  readonly id: string;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
}

export interface KnowledgeGraphEdgeView {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly predicate: string;
}

interface PositionedNode extends KnowledgeGraphNodeView {
  readonly x: number;
  readonly y: number;
}

interface KnowledgeGraphProps {
  readonly centerNodeId: string;
  readonly edges: readonly KnowledgeGraphEdgeView[];
  readonly nodes: readonly KnowledgeGraphNodeView[];
  readonly onExploreNode: (nodeId: string) => void;
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
  centerNodeId: string
): readonly PositionedNode[] {
  const center = nodes.find((node) => node.id === centerNodeId);
  const surrounding = nodes.filter((node) => node.id !== centerNodeId);
  const positioned = surrounding.map((node, index) => {
    const angle = (index / Math.max(surrounding.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = surrounding.length > 8 && index % 2 === 1 ? 35 : 27;
    return { ...node, x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
  });
  return center ? [{ ...center, x: 50, y: 50 }, ...positioned] : positioned;
}

function clippedLabel(value: string) {
  return value.length > 20 ? `${value.slice(0, 19)}…` : value;
}

export function KnowledgeGraph({ centerNodeId, edges, nodes, onExploreNode, onSelectNode, selectedNodeId }: KnowledgeGraphProps) {
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const kinds = useMemo(() => [...new Set(nodes.map((node) => node.kind))].sort(), [nodes]);
  const visibleNodes = nodes.filter((node) => node.id === centerNodeId || !hiddenKinds.has(node.kind));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId));
  const positionedNodes = layoutKnowledgeGraph(visibleNodes, centerNodeId);
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
    <section aria-label="Knowledge Graph 관계 지도" className={classes.explorer}>
      <div className={classes.canvas}>
        <div className={classes.toolbar}>
          <TextInput aria-label="Graph node 검색" className={classes.search} leftSection={<IconSearch size={15} />} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Node 찾기" size="xs" value={query} />
          <Group gap={4} wrap="nowrap">
            <Tooltip label="축소"><ActionIcon aria-label="Graph 축소" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))} variant="default"><IconMinus size={15} /></ActionIcon></Tooltip>
            <Text className={classes.zoomValue} ff="monospace" size="xs">{Math.round(zoom * 100)}%</Text>
            <Tooltip label="확대"><ActionIcon aria-label="Graph 확대" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))} variant="default"><IconPlus size={15} /></ActionIcon></Tooltip>
            <Tooltip label="화면에 맞춤"><ActionIcon aria-label="Graph 화면에 맞춤" onClick={() => setZoom(1)} variant="default"><IconFocusCentered size={15} /></ActionIcon></Tooltip>
          </Group>
        </div>
        <svg aria-label={`${visibleNodes.length}개 node와 ${visibleEdges.length}개 관계`} className={classes.graph} role="img" viewBox={`${viewOffset} ${viewOffset} ${viewSize} ${viewSize}`}>
          <defs><marker id="graph-arrow" markerHeight="5" markerWidth="5" orient="auto" refX="4" refY="2.5"><path className={classes.arrow} d="M 0 0 L 5 2.5 L 0 5 z" /></marker></defs>
          {visibleEdges.map((edge) => {
            const source = positions.get(edge.sourceNodeId);
            const target = positions.get(edge.targetNodeId);
            if (!source || !target) return null;
            const isActive = !selectedNode || selectedEdges.some((item) => item.id === edge.id);
            return <g data-muted={!isActive || undefined} key={edge.id}>
              <line className={classes.edge} markerEnd="url(#graph-arrow)" x1={source.x} x2={target.x} y1={source.y} y2={target.y} />
              <text className={classes.edgeLabel} x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 1.5}>{clippedLabel(edge.predicate)}</text>
            </g>;
          })}
          {positionedNodes.map((node) => {
            const isCenter = node.id === centerNodeId;
            const isSelected = node.id === selectedNode?.id;
            const isMuted = normalizedQuery ? !matchingIds.has(node.id) : Boolean(selectedNode && !neighborIds.has(node.id));
            const radius =
              (isCenter ? 5.3 : 4.1) +
              Math.min(degrees.get(node.id) ?? 0, 6) * 0.18;
            return <g aria-label={`${node.kind.toUpperCase()} ${node.canonicalName}`} className={classes.node} data-center={isCenter || undefined} data-muted={isMuted || undefined} data-search-match={matchingIds.has(node.id) || undefined} data-selected={isSelected || undefined} key={node.id} onClick={() => onSelectNode(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectNode(node.id); } }} role="button" style={{ "--node-accent": kindColor(node.kind) } as CSSProperties} tabIndex={0} transform={`translate(${node.x} ${node.y})`}>
              <circle r={radius} />
              <text className={classes.nodeKind} textAnchor="middle" y="-0.8">{node.kind.toUpperCase()}</text>
              <text className={classes.nodeLabel} textAnchor="middle" y="2.5">{clippedLabel(node.canonicalName)}</text>
            </g>;
          })}
        </svg>
        <div aria-label="Node 종류 필터" className={classes.legend} role="group">
          {kinds.map((kind) => <button aria-pressed={!hiddenKinds.has(kind)} className={classes.kindChip} data-disabled={hiddenKinds.has(kind) || undefined} key={kind} onClick={() => toggleKind(kind)} style={{ "--node-accent": kindColor(kind) } as CSSProperties} type="button"><span />{kind}</button>)}
        </div>
      </div>
      <Paper className={classes.inspector} p="md" radius="lg">
        {selectedNode ? <Stack gap="md">
          <Stack gap={4}><Group justify="space-between"><Badge color="gray" size="xs" variant="light">{selectedNode.kind}</Badge><Text c="dimmed" ff="monospace" size="xs">{degrees.get(selectedNode.id) ?? 0} relations</Text></Group><Title order={4}>{selectedNode.canonicalName}</Title></Stack>
          <Text c="dimmed" size="sm">{selectedNode.summary ?? "이 node에는 아직 요약이 없습니다."}</Text>
          <Stack gap="xs"><Text c="dimmed" fw={700} size="xs" tt="uppercase">Connected by</Text>
            {selectedEdges.length > 0 ? selectedEdges.map((edge) => {
              const isOutgoing = edge.sourceNodeId === selectedNode.id;
              const related = positions.get(isOutgoing ? edge.targetNodeId : edge.sourceNodeId);
              return <button className={classes.relation} key={edge.id} onClick={() => related && onSelectNode(related.id)} type="button"><IconRoute aria-hidden size={14} /><span>{isOutgoing ? "→" : "←"} {edge.predicate}</span><strong>{related?.canonicalName}</strong></button>;
            }) : <Text c="dimmed" size="sm">직접 연결된 관계가 없습니다.</Text>}
          </Stack>
          {selectedNode.id !== centerNodeId ? <Button leftSection={<IconFocusCentered size={15} />} onClick={() => onExploreNode(selectedNode.id)} size="compact-sm" variant="light">이 node 중심으로 탐색</Button> : null}
        </Stack> : null}
      </Paper>
    </section>
  );
}
