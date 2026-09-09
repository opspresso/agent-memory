"use client";

import { Accordion, ActionIcon, Badge, Button, Group, Modal, Paper, Stack, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { IconFocusCentered, IconRoute, IconSearch, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { KnowledgeGraphCanvas, graphKindColor as kindColor } from "./knowledge-graph-canvas";
import { knowledgeNodeDegrees, type KnowledgeGraphNodeView, type KnowledgeGraphEdgeView, type GraphParticle } from "./knowledge-graph-layout";
export type { KnowledgeGraphNodeView, KnowledgeGraphEdgeView } from "./knowledge-graph-layout";
import { useT } from "./_i18n/provider";
import classes from "./knowledge-graph.module.css";
import { SourceEvidence } from "./source-evidence";

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

export function KnowledgeGraph({ canDeleteEdge, canDeleteNode, centerNodeId, deletingResource, edges, nodes, onDeleteEdge, onDeleteNode, onExploreNode, onSelectNode, selectedNodeId }: KnowledgeGraphProps) {
  const t = useT();
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const graphRoot = useRef<HTMLElement>(null);
  const wasFullscreen = useRef(false);
  useEffect(() => {
    if (wasFullscreen.current && !fullscreen) { graphRoot.current?.querySelector<HTMLButtonElement>("[data-fullscreen-toggle]")?.focus(); }
    wasFullscreen.current = fullscreen;
  }, [fullscreen]);
  const layoutCache = useRef<{ center: string; particles: GraphParticle[] } | null>(null);
  const allowedNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const kinds = useMemo(() => [...new Set(nodes.map((node) => node.kind))].sort(), [nodes]);
  const visibleNodes = useMemo(() => nodes.filter((node) => node.id === centerNodeId || !hiddenKinds.has(node.kind)), [nodes, centerNodeId, hiddenKinds]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id));
    return edges.filter((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId));
  }, [edges, visibleNodes]);
  const positions = new Map(visibleNodes.map((node) => [node.id, node]));
  const degrees = knowledgeNodeDegrees(visibleNodes, visibleEdges);
  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId) ?? visibleNodes[0];
  const selectedEdges = selectedNode
    ? visibleEdges.filter((edge) => edge.sourceNodeId === selectedNode.id || edge.targetNodeId === selectedNode.id)
    : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingIds = new Set(normalizedQuery
    ? visibleNodes.filter((node) => `${node.canonicalName} ${node.kind}`.toLocaleLowerCase().includes(normalizedQuery)).map((node) => node.id)
    : []);
  const kindCounts = new Map(kinds.map((kind) => [kind, nodes.filter((node) => node.kind === kind).length]));

  function toggleKind(kind: string) {
    setHiddenKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const graph = (
    <section ref={graphRoot} aria-label={t("graph.mapLabel")} className={classes.explorer} data-fullscreen={fullscreen || undefined}>
      <div className={classes.canvas}>
        <div className={classes.toolbar}>
          <TextInput aria-label={t("graph.searchLabel")} className={classes.search} leftSection={<IconSearch size={15} />} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("graph.searchPlaceholder")} size="xs" value={query} />
        </div>
        <KnowledgeGraphCanvas nodes={visibleNodes} edges={visibleEdges} centerNodeId={centerNodeId}
          selectedNodeId={selectedNode?.id} matchingIds={matchingIds} queryActive={Boolean(normalizedQuery)}
          onSelectNode={onSelectNode} layoutCache={layoutCache} allowedNodeIds={allowedNodeIds} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen((value) => !value)} />
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
  return fullscreen ? <Modal opened fullScreen onClose={() => setFullscreen(false)} title={t("graph.mapLabel")}
    styles={{ body: { paddingTop: 0 }, header: { minHeight: 56 } }}>{graph}</Modal> : graph;
}
