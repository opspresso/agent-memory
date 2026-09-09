"use client";

import { Alert, Badge, Button, Group, Paper, Skeleton, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { knowledgeCurationHistoryResponseSchema } from "../api-response-schemas";
import { responseJson } from "../http-response";
import { SourceEvidence } from "../source-evidence";
import { useT } from "../_i18n/provider";

export function KnowledgeCurationHistory() {
  const t = useT();
  const [data, setData] = useState<z.infer<typeof knowledgeCurationHistoryResponseSchema>>();
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/knowledge/curation", { signal: controller.signal })
      .then((response) => responseJson(response, t("candidate.loadFailed"), knowledgeCurationHistoryResponseSchema))
      .then((result) => { if (!controller.signal.aborted) { setData(result); } })
      .catch(() => { if (!controller.signal.aborted) { setError(t("candidate.loadFailed")); } });
    return () => controller.abort();
  }, [t]);
  if (error) { return <Alert color="red">{error}</Alert>; }
  if (!data) { return <Skeleton height={200} />; }
  return <Stack>
    <Text c="dimmed" size="sm">{t("reviewQueue.historyDescription")}</Text>
    {data.sources.length === 0 ? <Text>{t("reviewQueue.noHistory")}</Text> : null}
    {data.sources.map(({ candidate, documentTitle, ordinal }) => <Paper key={candidate.id} p="md" withBorder>
      <Button variant="subtle" onClick={() => setSelected(selected === candidate.id ? undefined : candidate.id)} style={{ maxWidth: "100%" }}>
        <Text truncate>{documentTitle.normalize("NFKC")} · {t("source.chunk", { number: ordinal + 1 })}</Text>
      </Button>
      {selected === candidate.id ? <Stack gap="sm" mt="sm">
        <Text size="xs" c="dimmed">{candidate.assessment?.model} · {candidate.assessment?.assessedAt}</Text>
        {candidate.assessment?.items.map((item) => {
          const review = candidate.itemReviews?.find((review) => review.item === item.item);
          const entity = item.item.startsWith("entity:") ? candidate.graph.entities.find((entity) => entity.key === item.item.slice(7)) : undefined;
          const relation = item.item.startsWith("relationship:") ? candidate.graph.relationships[Number(item.item.slice(13))] : undefined;
          const name = (key: string) => candidate.graph.entities.find((entity) => entity.key === key)?.canonicalName ?? key;
          return <Paper p="sm" withBorder key={item.item}>
            <Group gap="xs"><Badge color={review?.decision === "accepted" ? "teal" : "gray"}>{t(review ? review.decision === "accepted" ? "reviewQueue.acceptedDecision" : "reviewQueue.ignoredDecision" : "reviewQueue.pendingDecision")}</Badge>
              {review ? <Badge variant="outline">{t(review.method === "automatic" ? "reviewQueue.automatic" : "reviewQueue.human")}</Badge> : null}</Group>
            <Text size="sm" fw={600} mt="xs">{entity?.canonicalName ?? (relation ? `${name(relation.sourceKey)} → ${relation.predicate} → ${name(relation.targetKey)}` : item.item)}</Text>
            <Text size="sm">{item.reason}</Text>
            {item.evidence ? <Text size="sm" c="dimmed">“{item.evidence}”</Text> : null}
          </Paper>;
        })}
        <SourceEvidence chunkId={candidate.chunkId} />
      </Stack> : null}
    </Paper>)}
  </Stack>;
}
