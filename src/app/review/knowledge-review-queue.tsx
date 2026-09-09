"use client";

import { Alert, Badge, Button, Checkbox, Group, Pagination, Paper, ScrollArea, Skeleton, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useT } from "../_i18n/provider";
import { knowledgeReviewGroupsResponseSchema, type KnowledgeReviewGroupsResponse } from "../api-response-schemas";
import { responseJson, responseOk } from "../http-response";
import { SourceEvidence } from "../source-evidence";
import { WorkspaceHeader } from "../workspace-components";
import classes from "../knowledge-candidate-review.module.css";

type ReviewGroup = KnowledgeReviewGroupsResponse["groups"][number];

function GroupReview({ group, onReviewed, onBusy }: { group: ReviewGroup; onReviewed: (message: string) => void; onBusy: (busy: boolean) => void }) {
  const t = useT();
  const [selected, setSelected] = useState(() => group.occurrences.map((_, index) => index));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string>();
  const blocked = group.ontology.mode === "strict" && group.ontology.violations.length > 0;

  async function review(action: "accept" | "reject") {
    setBusy(true);
    onBusy(true);
    setError(undefined);
    const requests = new Map<string, { entityKeys: Set<string>; relationshipIndexes: Set<number> }>();
    for (const index of selected) {
      const occurrence = group.occurrences[index]!;
      const selection = requests.get(occurrence.candidateId) ?? { entityKeys: new Set<string>(), relationshipIndexes: new Set<number>() };
      occurrence.selection.entityKeys.forEach((key) => selection.entityKeys.add(key));
      occurrence.selection.relationshipIndexes.forEach((index) => selection.relationshipIndexes.add(index));
      requests.set(occurrence.candidateId, selection);
    }
    let completed = 0;
    try {
      for (const [candidateId, selection] of requests) {
        await responseOk(await fetch(`/api/knowledge/candidates/${candidateId}/${action}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selection: { entityKeys: [...selection.entityKeys], relationshipIndexes: [...selection.relationshipIndexes] }, ...(reason.trim() ? { reason: reason.trim() } : {}) })
        }), t("candidate.requestFailed"));
        completed += 1;
      }
      onReviewed(t("reviewQueue.completed", { count: completed }));
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : t("candidate.requestFailed");
      if (completed > 0) {
        onReviewed(`${t("reviewQueue.partial", { count: completed })} ${detail}`);
      } else { setError(detail); }
    } finally { setBusy(false); onBusy(false); }
  }

  return <Paper className={classes.candidate} p="lg" withBorder>
    <Stack gap="md">
      <Title order={2} style={{ overflowWrap: "anywhere" }}>{group.title}</Title>
      <Group gap="xs">
        <Badge>{t(`reviewQueue.${group.kind}`)}</Badge>
        <Badge variant="light">{t(`workspace.scope.${group.scope.kind}`)}</Badge>
        <Text size="sm" c="dimmed">{t("reviewQueue.support", { count: group.occurrences.length, documents: group.documentCount })}</Text>
      </Group>
      <Text size="sm" c="dimmed">{t("reviewQueue.explanation")}</Text>
      {group.weak ? <Alert color="yellow">{t("reviewQueue.weak")}</Alert> : null}
      {group.evidenceCount === 0 ? <Alert color="gray">{t("reviewQueue.legacy")}</Alert> : null}
      {group.ontology.violations.length ? <Alert color={blocked ? "red" : "orange"}>{t(blocked ? "candidate.ontologyStrict" : "candidate.ontologyWarn", { terms: group.ontology.violations.map((violation) => violation.term).join(", ") })}</Alert> : null}
      {error ? <Alert color="red" role="alert">{error}</Alert> : null}
      <Checkbox label={t("reviewQueue.selectAll")} checked={selected.length === group.occurrences.length} indeterminate={selected.length > 0 && selected.length < group.occurrences.length} disabled={busy}
        onChange={(event) => setSelected(event.currentTarget.checked ? group.occurrences.map((_, index) => index) : [])} />
      <ScrollArea.Autosize mah={560} type="auto">
        <Stack gap="sm">
          {group.occurrences.map((occurrence, index) => <Paper key={`${occurrence.candidateId}:${index}`} p="md" className={classes.fact}>
            <Stack gap="xs">
              <Checkbox checked={selected.includes(index)} disabled={busy} label={`${occurrence.documentTitle.normalize("NFKC")} · ${t("source.chunk", { number: occurrence.ordinal + 1 })}`}
                onChange={(event) => setSelected(event.currentTarget.checked ? [...selected, index] : selected.filter((value) => value !== index))} />
              {occurrence.aliases.length ? <Text size="sm">{t("reviewQueue.aliases", { names: occurrence.aliases.join(", ") })}</Text> : null}
              {occurrence.summary ? <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>{occurrence.summary}</Text> : null}
              {occurrence.assessmentReason ? <Alert color="yellow">{occurrence.assessmentReason}</Alert> : null}
              {occurrence.evidence.map((quote, quoteIndex) => <Text component="blockquote" size="sm" c="dimmed" key={quoteIndex} style={{ margin: 0, overflowWrap: "anywhere" }}>“{quote}”</Text>)}
              <Button variant="subtle" size="xs" onClick={() => setExpanded(expanded === `${index}` ? undefined : `${index}`)}>{t("reviewQueue.source")}</Button>
              {expanded === `${index}` ? <SourceEvidence chunkId={occurrence.chunkId} /> : null}
            </Stack>
          </Paper>)}
        </Stack>
      </ScrollArea.Autosize>
      <Textarea label={t("candidate.reason")} value={reason} onChange={(event) => setReason(event.currentTarget.value)} maxLength={2_000} disabled={busy} />
      <Group justify="flex-end">
        <Button variant="subtle" color="red" disabled={!selected.length} loading={busy} onClick={() => void review("reject")}>{t("reviewQueue.reject")}</Button>
        <Button color="teal" disabled={!selected.length || blocked} loading={busy} onClick={() => void review("accept")}>{t("reviewQueue.accept", { count: selected.length })}</Button>
      </Group>
    </Stack>
  </Paper>;
}

export function KnowledgeReviewQueue({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<KnowledgeReviewGroupsResponse>();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [queueing, setQueueing] = useState(false);
  async function queueCuration() {
    setQueueing(true);
    setError(undefined);
    try {
      const result = await responseJson(await fetch("/api/knowledge/curation", { method: "POST" }), t("candidate.requestFailed"), z.object({ queued: z.number() }));
      setMessage(t("reviewQueue.queued", { count: result.queued }));
      setAttempt((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("candidate.requestFailed")); }
    finally { setQueueing(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(`/api/knowledge/review-groups?offset=${(page - 1) * 25}&limit=25&query=${encodeURIComponent(search)}`, { signal: controller.signal });
        const result = await responseJson(response, t("candidate.loadFailed"), knowledgeReviewGroupsResponseSchema);
        if (!controller.signal.aborted) {
          if (page > 1 && result.groups.length === 0) { setPage(1); }
          setData(result);
        }
      } catch {
        if (!controller.signal.aborted) { setData(undefined); setError(t("candidate.loadFailed")); }
      } finally { if (!controller.signal.aborted) { setLoading(false); } }
    }
    void load();
    return () => controller.abort();
  }, [attempt, page, search, t]);
  const selected = data?.groups.find((group) => group.key === selectedKey) ?? data?.groups[0];
  return <Stack gap="lg">
    <WorkspaceHeader title={t("candidate.title")} description={t("reviewQueue.lede")} actions={<Button variant="default" loading={loading} disabled={busy} onClick={() => setAttempt((value) => value + 1)}>{t("candidate.refresh")}</Button>} />
    <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(query); }}><Group align="flex-end">
      <TextInput label={t("reviewQueue.search")} disabled={busy} value={query} onChange={(event) => setQuery(event.currentTarget.value)} maxLength={500} style={{ flex: 1 }} />
      <Button type="submit" disabled={busy}>{t("reviewQueue.searchButton")}</Button>
    </Group></form>
    {message ? <Alert role="status">{message}</Alert> : null}
    {error ? <Alert color="red" role="alert">{error}</Alert> : null}
    <Group><Button loading={queueing} disabled={busy} onClick={() => void queueCuration()}>{t("reviewQueue.automate")}</Button>
      <Text size="sm" c="dimmed">{t("reviewQueue.autoPolicy")}</Text></Group>
    {loading ? <Skeleton height={300} /> : data ? <>
      <Group><Badge color="teal">{t("reviewQueue.autoAccepted", { count: data.automaticAccepted })}</Badge><Badge color="gray">{t("reviewQueue.autoIgnored", { count: data.automaticIgnored })}</Badge></Group>
      {data.unassessedCount > 0 ? <Alert>{t("reviewQueue.unassessed", { count: data.unassessedCount })}</Alert> : null}
      <Text size="sm" c="dimmed">{t("reviewQueue.total", { count: data.total, sources: data.sourceCount })}</Text>
      {selected ? <div className={classes.reviewGrid}>
        <ScrollArea className={classes.queue}><Stack gap="xs">
          {data.groups.map((group) => <button type="button" key={group.key} disabled={busy} className={classes.queueItem} aria-pressed={selected.key === group.key} data-active={selected.key === group.key || undefined} onClick={() => setSelectedKey(group.key)}>
            <span title={group.title}>{group.title}</span>
            <small>{t(`reviewQueue.${group.kind}`)} · {t(`workspace.scope.${group.scope.kind}`)}</small>
            <small>{t("reviewQueue.support", { count: group.occurrences.length, documents: group.documentCount })}</small>
          </button>)}
        </Stack></ScrollArea>
        <GroupReview key={`${selected.key}:${attempt}`} group={selected} onBusy={(value) => { setBusy(value); onBusyChange(value); }} onReviewed={(message) => { setMessage(message); setAttempt((value) => value + 1); }} />
      </div> : <Paper p="xl" withBorder><Text>{t("candidate.emptyTitle")}</Text></Paper>}
      {data.total > 25 ? <Pagination disabled={busy} value={page} onChange={setPage} total={Math.ceil(data.total / 25)} /> : null}
    </> : null}
  </Stack>;
}
