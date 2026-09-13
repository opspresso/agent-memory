"use client";

import { Alert, Button, Group, Progress, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

const progressSchema = z.object({ totalChunks: z.number(), extractedChunks: z.number(), curatedChunks: z.number(), enabled: z.boolean() });

export function KnowledgeProcessingStatus({ query }: { readonly query: string }) {
  const t = useT();
  const { access } = useOrganization();
  const [progress, setProgress] = useState<z.infer<typeof progressSchema>>();
  const [message, setMessage] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/knowledge/progress", { signal: controller.signal });
        const value = await responseJson(response, t("candidate.loadFailed"), progressSchema);
        if (!controller.signal.aborted) { setProgress(value); setLoadError(undefined); }
      } catch { if (!controller.signal.aborted) { setLoadError(t("knowledgeProgress.unavailable")); } }
    }
    void load();
    const timer = setInterval(() => { if (!document.hidden) { void load(); } }, 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [t]);
  async function prioritize() {
    setBusy(true);
    try {
      const response = await fetch(`/api/knowledge/curation?query=${encodeURIComponent(query)}`, { method: "POST" });
      const result = await responseJson(response, t("candidate.requestFailed"), z.object({ queued: z.number() }));
      setMessage(t(query ? "knowledgeProgress.prioritized" : "knowledgeProgress.retried", { count: result.queued }));
    } catch (error) { setMessage(error instanceof Error ? error.message : t("candidate.requestFailed")); }
    finally { setBusy(false); }
  }
  if (!progress) { return loadError ? <Alert color="gray">{loadError}</Alert> : null; }
  if (!progress.enabled || progress.totalChunks === 0 || progress.curatedChunks === progress.totalChunks) { return null; }
  return <Alert color="blue" title={t("knowledgeProgress.title")}>
    <Text size="sm">{t("knowledgeProgress.body", { total: progress.totalChunks, extracted: progress.extractedChunks, completed: progress.curatedChunks })}</Text>
    <Progress mt="sm" value={100 * progress.curatedChunks / progress.totalChunks} aria-label={t("knowledgeProgress.title")} />
    <Group mt="sm"><Text size="sm">{t("knowledgeProgress.partial")}</Text>
      {access ?
        <Button size="xs" variant="light" loading={busy} onClick={() => void prioritize()}>{t(query ? "knowledgeProgress.prioritize" : "knowledgeProgress.retry")}</Button> : null}
    </Group>
    {message ? <Text size="sm" mt="xs" role="status">{message}</Text> : null}
    {loadError ? <Text size="sm" mt="xs" role="alert">{loadError}</Text> : null}
  </Alert>;
}
