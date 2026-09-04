"use client";

import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import {
  IconArchive,
  IconBrain,
  IconFileText,
  IconHistory,
  IconTopologyStar3
} from "@tabler/icons-react";

import type { ScopedResource } from "@/domain/identity/organization-access";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";

import { useT } from "./_i18n/provider";
import type { SearchHitResponse } from "./api-response-schemas";
import {
  contextResultPresentation,
  relativeRelevance
} from "./context-result-presentation";
import classes from "./page.module.css";

interface SearchResultCardProps {
  readonly canManage: (scope: ScopedResource) => boolean;
  readonly hit: SearchHitResponse;
  readonly hits: readonly SearchHitResponse[];
  readonly loadingGraph: boolean;
  readonly onArchiveDocument: (id: string, name: string) => void;
  readonly onExploreNode: (nodeId: string) => void;
  readonly onMergeNodes: (
    targetNodeId: string,
    sourceNodeId: string,
    name: string
  ) => void;
  readonly onSelectMemory: (memoryId: string) => void;
  readonly peakScore: number;
  readonly showGraphAction: boolean;
}

function sameScope(left: ScopedResource, right: ScopedResource): boolean {
  return (
    left.kind === right.kind &&
    left.organizationId === right.organizationId &&
    (left.kind !== "team" ||
      (right.kind === "team" && left.teamId === right.teamId)) &&
    (left.kind !== "user" ||
      (right.kind === "user" && left.userId === right.userId))
  );
}

function resultTitle(hit: SearchHitResponse, fallback: string): string {
  return hit.memory?.title ?? hit.document?.title ?? hit.node?.canonicalName ?? fallback;
}

function resultSummary(hit: SearchHitResponse): string {
  return hit.memory?.content ?? hit.chunk?.content ?? hit.node?.summary ?? hit.node?.kind ?? "";
}

export function searchResultKey(hit: SearchHitResponse): string {
  const source = hit.memory ?? hit.document ?? hit.node;
  return `${source?.id ?? "result"}:${hit.chunk?.id ?? "root"}`;
}

export function SearchResultCard({
  canManage,
  hit,
  hits,
  loadingGraph,
  onArchiveDocument,
  onExploreNode,
  onMergeNodes,
  onSelectMemory,
  peakScore,
  showGraphAction
}: SearchResultCardProps) {
  const t = useT();
  const { node, document, memory } = hit;
  const presentation = contextResultPresentation(hit, t);
  const relevance = relativeRelevance(presentation.score, peakScore);
  const canManageMemory = Boolean(
    memory?.capabilities?.write || memory?.capabilities?.manage
  );
  const canManageDocument = Boolean(document && canManage(document.scope));
  const duplicateNode = node
    ? hits
        .map((candidate) => candidate.node)
        .find(
          (candidate) =>
            candidate &&
            candidate.id !== node.id &&
            knowledgeCanonicalNameKey(candidate.canonicalName) ===
              knowledgeCanonicalNameKey(node.canonicalName) &&
            sameScope(candidate.scope, node.scope) &&
            canManage(candidate.scope)
        )
    : undefined;

  return (
    <Paper
      className={classes.resultCard}
      data-source={presentation.sourceType}
      p="md"
      withBorder
    >
      <Stack gap="xs">
        <Group justify="space-between">
          <Group gap="xs">
            {presentation.sourceType === "memory" ? (
              <IconBrain aria-hidden size={17} />
            ) : presentation.sourceType === "document" ? (
              <IconFileText aria-hidden size={17} />
            ) : (
              <IconTopologyStar3 aria-hidden size={17} />
            )}
            <Badge color="gray" variant="light">
              {presentation.sourceLabel}
            </Badge>
            <Badge color="gray" variant="outline">
              {presentation.scopeLabel}
            </Badge>
          </Group>
          {presentation.score !== undefined ? (
            <Text c="dimmed" ff="monospace" size="xs">
              {presentation.score.toFixed(3)}
            </Text>
          ) : null}
        </Group>
        <Text fw={650}>{resultTitle(hit, t("workspace.resultFallback"))}</Text>
        {node ? (
          <Group gap="xs">
            <Badge size="xs" variant="dot">
              {node.kind}
            </Badge>
            <Text c="dimmed" size="xs">
              {t("workspace.nodeSources", { count: node.sources?.length ?? 0 })}
            </Text>
          </Group>
        ) : null}
        <Text c="dimmed" lineClamp={4} size="sm">
          {resultSummary(hit)}
        </Text>
        <div className={classes.evidenceRail}>
          <Group justify="space-between" wrap="nowrap">
            <Text c="dimmed" lineClamp={1} size="xs">
              {presentation.evidenceLabel}
            </Text>
            <Text fw={700} size="xs">
              {t("workspace.relativeRelevance", { value: relevance })}
            </Text>
          </Group>
          <div
            aria-label={t("workspace.relativeRelevance", { value: relevance })}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={relevance}
            className={classes.relevanceTrack}
            role="meter"
          >
            <span style={{ width: `${relevance}%` }} />
          </div>
          <Group gap="lg">
            {presentation.lexicalScore !== undefined ? (
              <Text c="dimmed" ff="monospace" size="xs">
                lexical {presentation.lexicalScore.toFixed(3)}
              </Text>
            ) : null}
            {presentation.vectorScore !== undefined ? (
              <Text c="dimmed" ff="monospace" size="xs">
                vector {presentation.vectorScore.toFixed(3)}
              </Text>
            ) : null}
          </Group>
        </div>
        {showGraphAction && node ? (
          <Button
            leftSection={<IconTopologyStar3 size={16} />}
            loading={loadingGraph}
            onClick={() => onExploreNode(node.id)}
            size="compact-sm"
            variant="light"
          >
            {t("workspace.viewRelationships")}
          </Button>
        ) : null}
        {node && duplicateNode && canManage(node.scope) ? (
          <Button
            color="orange"
            onClick={() =>
              onMergeNodes(node.id, duplicateNode.id, node.canonicalName)
            }
            size="compact-sm"
            variant="light"
          >
            {t("resource.mergeDuplicate")}
          </Button>
        ) : null}
        {memory && canManageMemory ? (
          <Button
            leftSection={<IconHistory size={16} />}
            onClick={() => onSelectMemory(memory.id)}
            size="compact-sm"
            variant="light"
          >
            Lifecycle
          </Button>
        ) : null}
        {document && canManageDocument ? (
          <Button
            color="red"
            leftSection={<IconArchive size={16} />}
            onClick={() =>
              onArchiveDocument(
                document.id,
                document.title || t("workspace.resultFallback")
              )
            }
            size="compact-sm"
            variant="subtle"
          >
            {t("resource.archiveDocument")}
          </Button>
        ) : null}
      </Stack>
    </Paper>
  );
}
