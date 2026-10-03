"use client";

import { Alert, Badge, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { z } from "zod";

import { useLocale, useT } from "./_i18n/provider";
import { memoryVersionsResponseSchema } from "./api-response-schemas";
import { responseJson } from "./http-response";
import classes from "./memory-lifecycle.module.css";

type MemoryVersion = z.infer<typeof memoryVersionsResponseSchema>["versions"][number];

export function MemoryVersionHistory({ memoryId }: { readonly memoryId: string }) {
  const t = useT();
  const locale = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const [versions, setVersions] = useState<readonly MemoryVersion[]>([]);
  const [nextBefore, setNextBefore] = useState<number>();
  const [request, setRequest] = useState<{ before?: number; attempt: number }>({ attempt: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ limit: "25" });
        if (request.before !== undefined) query.set("before", String(request.before));
        const response = await fetch(`/api/memories/${memoryId}/versions?${query}`, {
          signal: controller.signal
        });
        if (controller.signal.aborted) return;
        if (response.status === 403 || response.status === 404) {
          setVersions([]);
          setNextBefore(undefined);
        }
        const body = await responseJson(response, t("memory.historyFailed"), memoryVersionsResponseSchema);
        if (controller.signal.aborted) return;
        if (body.versions.some((version) => version.memoryId !== memoryId)) {
          throw new Error(t("memory.historyFailed"));
        }
        setVersions((current) => request.before === undefined
          ? body.versions
          : [...new Map([...current, ...body.versions].map((version) => [version.version, version])).values()]);
        setNextBefore(body.nextBefore);
        setError(undefined);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : t("memory.historyFailed"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [memoryId, request, t]);

  function loadPage(before?: number) {
    setLoading(true);
    setError(undefined);
    setRequest((current) => ({ before, attempt: current.attempt + 1 }));
  }

  return <Stack gap="md">
    {versions.map((version) => (
      <article className={classes.version} key={version.version}>
        <Group justify="space-between">
          <Badge color="gray" variant="light">v{version.version}</Badge>
          <Text c="dimmed" size="xs">{version.status}</Text>
        </Group>
        <Text fw={700}>{version.title}</Text>
        <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {version.content}
        </Text>
        {version.changeReason ? <Text className={classes.reason} size="sm">“{version.changeReason}”</Text> : null}
        <Text c="dimmed" ff="monospace" size="xs">
          {version.changedBy} · {dateFormatter.format(new Date(version.createdAt))}
        </Text>
      </article>
    ))}
    {loading ? <Group role="status"><Loader size="sm" /><Text size="sm">{t("memory.historyLoading")}</Text></Group> : null}
    {error ? <Alert color="red" role="alert"><Stack gap="xs">
      <Text size="sm">{error}</Text>
      <Button variant="light" onClick={() => loadPage(request.before)}>{t("memory.historyRetry")}</Button>
    </Stack></Alert> : null}
    {!error && nextBefore !== undefined ? <Button variant="default" disabled={loading} onClick={() => loadPage(nextBefore)}>{t("memory.historyMore")}</Button> : null}
  </Stack>;
}
