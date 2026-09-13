"use client";

import { Accordion, Anchor, Badge, Button, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBrain, IconFileText, IconTopologyStar3 } from "@tabler/icons-react";
import Link from "next/link";

import type { ScopedResource } from "@/domain/identity/organization-access";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";

import { useT } from "./_i18n/provider";
import type { SearchHitResponse } from "./api-response-schemas";
import { contextResultPresentation, relativeRelevance } from "./context-result-presentation";
import { SourceEvidence } from "./source-evidence";
import classes from "./search-workspace.module.css";

function sameScope(left: ScopedResource, right: ScopedResource): boolean {
  return left.kind === right.kind && left.organizationId === right.organizationId &&
    (left.kind !== "team" || (right.kind === "team" && left.teamId === right.teamId)) &&
    (left.kind !== "user" || (right.kind === "user" && left.userId === right.userId));
}

export function searchResultKey(hit: SearchHitResponse): string {
  const source = hit.memory ?? hit.document ?? hit.node;
  return `${source?.id ?? "result"}:${hit.chunk?.id ?? "root"}`;
}

export function SearchResultCard({ hit, selected, onSelect }: {
  readonly hit: SearchHitResponse;
  readonly selected: boolean;
  readonly onSelect: (button: HTMLButtonElement) => void;
}) {
  const t = useT();
  const presentation = contextResultPresentation(hit, t);
  const title = hit.memory?.title ?? hit.document?.title ?? hit.node?.canonicalName ?? t("workspace.resultFallback");
  const summary = hit.memory?.content ?? hit.chunk?.content ?? hit.node?.summary ?? "";
  const Icon = hit.memory ? IconBrain : hit.document ? IconFileText : IconTopologyStar3;
  return (
    <UnstyledButton className={classes.result} data-selected={selected || undefined} aria-label={`${title} · ${presentation.sourceLabel} · ${presentation.scopeLabel} · ${presentation.evidenceLabel}`} aria-pressed={selected} onClick={(event) => onSelect(event.currentTarget)}>
      <Stack gap={8}>
        <Group gap="xs"><Icon size={16} aria-hidden /><Badge size="xs">{presentation.sourceLabel}</Badge><Text c="dimmed" size="xs">{presentation.scopeLabel}</Text></Group>
        <Text fw={600} size="sm" className={classes.title}>{title}</Text>
        <Text c="dimmed" lineClamp={2} size="sm">{summary}</Text>
        <Text c="dimmed" size="xs">{presentation.evidenceLabel}</Text>
      </Stack>
    </UnstyledButton>
  );
}

export function SearchHitDetails({ hit, hits, canManage, onExploreNode, onMergeNodes, loadingGraph, peakScore }: {
  readonly hit: SearchHitResponse;
  readonly hits: readonly SearchHitResponse[];
  readonly canManage: (scope: ScopedResource) => boolean;
  readonly onExploreNode: (nodeId: string) => void;
  readonly onMergeNodes: (target: string, source: string, name: string) => void;
  readonly loadingGraph: boolean;
  readonly peakScore: number;
}) {
  const t = useT();
  const { node, document, memory, chunk } = hit;
  const presentation = contextResultPresentation(hit, t);
  const duplicate = node ? hits.map((candidate) => candidate.node).find((candidate) => candidate &&
    candidate.id !== node.id && knowledgeCanonicalNameKey(candidate.canonicalName) === knowledgeCanonicalNameKey(node.canonicalName) &&
    sameScope(candidate.scope, node.scope) && canManage(candidate.scope)) : undefined;

  return (
    <Stack gap="lg">
      <Group gap="xs"><Badge>{presentation.sourceLabel}</Badge><Badge variant="outline">{presentation.scopeLabel}</Badge></Group>
      <Group align="center" gap="sm" justify="space-between" wrap="nowrap"><Text fw={650} fz="lg" className={classes.title}>{memory?.title ?? document?.title ?? node?.canonicalName}</Text>{node ? <Button variant="light" loading={loadingGraph} onClick={() => onExploreNode(node.id)} leftSection={<IconTopologyStar3 size={16} />} size="compact-sm">{t("workspace.viewRelationships")}</Button> : null}</Group>
      {node ? (
        <>
          <Badge variant="dot">{node.kind}</Badge>
          {node.aliases.length ? <Text size="sm">{t("graph.aliases")}: {node.aliases.join(", ")}</Text> : null}
          <Text size="sm" className={classes.body}>{node.summary}</Text>
          {duplicate && canManage(node.scope) ? <Button variant="default" color="orange" onClick={() => onMergeNodes(node.id, duplicate.id, node.canonicalName)}>{t("resource.mergeDuplicate")}</Button> : null}
          <Text fw={600} size="sm">{t("source.title")}</Text>
          {node.sources?.map((source) => <SourceEvidence key={"memoryId" in source ? source.memoryId : source.chunkId} {...source} />)}
        </>
      ) : null}
      {document && chunk ? <SourceEvidence chunkId={chunk.id} /> : null}
      {document ? <Anchor component={Link} href={`/documents?document=${encodeURIComponent(document.id)}`} size="sm">{t("searchUi.openDocument")}</Anchor> : null}
      <Accordion variant="separated">
        <Accordion.Item value="ranking">
          <Accordion.Control>{t("searchUi.ranking")}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="sm">{t("workspace.relativeRelevance", { value: relativeRelevance(presentation.score, peakScore) })}</Text>
              <Text size="xs" c="dimmed">{t("searchUi.rankingHint")}</Text>
              {presentation.lexicalScore !== undefined ? <Text size="xs">lexical {presentation.lexicalScore.toFixed(3)}</Text> : null}
              {presentation.vectorScore !== undefined ? <Text size="xs">vector {presentation.vectorScore.toFixed(3)}</Text> : null}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
