"use client";

import { Badge, Group, Paper, Stack, Text, Title } from "@mantine/core";

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
  readonly onSelectNode: (nodeId: string) => void;
  readonly selectedNodeId: string;
}

export function layoutKnowledgeGraph(
  nodes: readonly KnowledgeGraphNodeView[],
  centerNodeId: string
): readonly PositionedNode[] {
  const center = nodes.find((node) => node.id === centerNodeId);
  const surrounding = nodes.filter((node) => node.id !== centerNodeId);
  const positioned = surrounding.map((node, index) => {
    const angle = (index / Math.max(surrounding.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = surrounding.length > 8 && index % 2 === 1 ? 34 : 27;
    return {
      ...node,
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius
    };
  });
  return center
    ? [{ ...center, x: 50, y: 50 }, ...positioned]
    : positioned;
}

function clippedLabel(value: string) {
  return value.length > 20 ? `${value.slice(0, 19)}…` : value;
}

export function KnowledgeGraph({
  centerNodeId,
  edges,
  nodes,
  onSelectNode,
  selectedNodeId
}: KnowledgeGraphProps) {
  const positionedNodes = layoutKnowledgeGraph(nodes, centerNodeId);
  const positions = new Map(positionedNodes.map((node) => [node.id, node]));
  const selectedNode =
    positionedNodes.find((node) => node.id === selectedNodeId) ??
    positionedNodes[0];

  return (
    <section aria-label="Knowledge Graph 관계 지도" className={classes.explorer}>
      <div className={classes.canvas}>
        <svg
          aria-label={`${nodes.length}개 node와 ${edges.length}개 관계`}
          className={classes.graph}
          role="img"
          viewBox="0 0 100 100"
        >
          <defs>
            <marker
              id="graph-arrow"
              markerHeight="5"
              markerWidth="5"
              orient="auto"
              refX="4"
              refY="2.5"
            >
              <path className={classes.arrow} d="M 0 0 L 5 2.5 L 0 5 z" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const source = positions.get(edge.sourceNodeId);
            const target = positions.get(edge.targetNodeId);
            if (!source || !target) {
              return null;
            }
            const labelX = (source.x + target.x) / 2;
            const labelY = (source.y + target.y) / 2;
            return (
              <g key={edge.id}>
                <line
                  className={classes.edge}
                  markerEnd="url(#graph-arrow)"
                  x1={source.x}
                  x2={target.x}
                  y1={source.y}
                  y2={target.y}
                />
                <text className={classes.edgeLabel} x={labelX} y={labelY - 1.5}>
                  {clippedLabel(edge.predicate)}
                </text>
              </g>
            );
          })}
          {positionedNodes.map((node) => {
            const isCenter = node.id === centerNodeId;
            const isSelected = node.id === selectedNodeId;
            return (
              <g
                className={classes.node}
                data-center={isCenter || undefined}
                data-selected={isSelected || undefined}
                key={node.id}
                onClick={() => onSelectNode(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectNode(node.id);
                  }
                }}
                role="button"
                tabIndex={0}
                transform={`translate(${node.x} ${node.y})`}
              >
                <circle r={isCenter ? 8.5 : 6.5} />
                <text className={classes.nodeKind} textAnchor="middle" y="-1">
                  {node.kind.toUpperCase()}
                </text>
                <text className={classes.nodeLabel} textAnchor="middle" y="2.8">
                  {clippedLabel(node.canonicalName)}
                </text>
              </g>
            );
          })}
        </svg>
        <Group className={classes.legend} gap="xs">
          <Badge color="indigo" variant="filled">중심</Badge>
          <Badge color="gray" variant="light">연결 node</Badge>
        </Group>
      </div>
      <Paper className={classes.inspector} p="lg" radius="lg">
        {selectedNode ? (
          <Stack gap="md">
            <Stack gap={4}>
              <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                {selectedNode.kind}
              </Text>
              <Title order={3}>{selectedNode.canonicalName}</Title>
            </Stack>
            <Text c="dimmed" size="sm">
              {selectedNode.summary ?? "이 node에는 아직 요약이 없습니다."}
            </Text>
            <Text c="dimmed" size="xs">
              node를 선택하면 세부 정보를 확인하고, 두 번 선택하면 해당 node를 중심으로 관계를 다시 탐색합니다.
            </Text>
          </Stack>
        ) : null}
      </Paper>
    </section>
  );
}
