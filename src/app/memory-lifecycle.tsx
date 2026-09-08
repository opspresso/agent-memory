"use client";

import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title
} from "@mantine/core";
import {
  IconArchive,
  IconDeviceFloppy,
  IconRefresh
} from "@tabler/icons-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ScopedResource } from "@/domain/identity/organization-access";

import { useLocale, useT } from "./_i18n/provider";
import {
  memoryDetailResponseSchema,
  memoryVersionsResponseSchema
} from "./api-response-schemas";
import { responseJson, responseOk } from "./http-response";
import classes from "./memory-lifecycle.module.css";

interface MemoryCapabilitiesView {
  readonly write: boolean;
  readonly manage: boolean;
}

interface MemorySourceView {
  readonly type: string;
  readonly uri?: string;
  readonly agentId?: string;
}

interface MemoryDetailView {
  readonly id: string;
  readonly scope?: ScopedResource;
  readonly kind: string;
  readonly title: string;
  readonly content: string;
  readonly source: MemorySourceView;
  readonly status: "active" | "archived";
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly validFrom: string;
  readonly expiresAt?: string;
  readonly capabilities: MemoryCapabilitiesView;
}

interface MemoryVersionView {
  readonly memoryId: string;
  readonly version: number;
  readonly title: string;
  readonly content: string;
  readonly source: MemorySourceView;
  readonly status: "active" | "archived";
  readonly changedBy: string;
  readonly changeReason?: string;
  readonly createdAt: string;
}

interface MemoryLifecycleProps {
  readonly embedded?: boolean;
  readonly memoryId: string;
  readonly onClose: () => void;
  readonly onChanged: () => void;
  readonly organizationSlug: string;
}

interface LoadedMemory {
  readonly etag: string;
  readonly memory: MemoryDetailView;
  readonly versions: readonly MemoryVersionView[];
}

class MemoryUnavailableError extends Error {}

async function requestMemory(
  memoryId: string,
  fallback: string,
  etagMissing: string,
  unavailable: string,
  signal?: AbortSignal
): Promise<LoadedMemory> {
  const response = await fetch(
    `/api/memories/${memoryId}`,
    { signal }
  );
  if (response.status === 403 || response.status === 404) {
    throw new MemoryUnavailableError(unavailable);
  }
  const memory = await responseJson(
    response,
    fallback,
    memoryDetailResponseSchema
  );
  const etag = response.headers.get("etag");
  if (!etag) {
    throw new Error(etagMissing);
  }
  if (!memory.capabilities.manage) {
    return { memory, etag, versions: [] };
  }
  const versionsResponse = await fetch(
    `/api/memories/${memoryId}/versions?limit=100`,
    { signal }
  );
  const versionsBody = await responseJson(
    versionsResponse,
    fallback,
    memoryVersionsResponseSchema
  );
  return { memory, etag, versions: versionsBody.versions };
}

function formattedDate(value: string, locale: "en" | "ko") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function MemoryLifecycle({
  embedded = false,
  memoryId,
  onClose,
  onChanged,
  organizationSlug
}: MemoryLifecycleProps) {
  const locale = useLocale();
  const t = useT();
  const [loaded, setLoaded] = useState<LoadedMemory>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const mounted = useRef(true);
  const readRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readRequest.current?.abort();
      mutationRequest.current?.abort();
    };
  }, []);
  const getLoadMessages = useEffectEvent(() => ({
    requestFailed: t("memory.requestFailed"),
    etagMissing: t("memory.etagMissing"),
    unavailable: t("memoryUi.unavailable"),
    loadFailed: t("memory.loadFailed")
  }));

  function applyLoaded(next: LoadedMemory) {
    setLoaded(next);
    setTitle(next.memory.title);
    setContent(next.memory.content);
    setReason("");
    setConfirmArchive(false);
  }

  async function loadMemory() {
    if (!mounted.current) return;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      const next = await requestMemory(
        memoryId,
        t("memory.requestFailed"),
        t("memory.etagMissing"),
        t("memoryUi.unavailable"),
        controller.signal
      );
      if (!controller.signal.aborted && mounted.current) applyLoaded(next);
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      if (caught instanceof MemoryUnavailableError) setLoaded(undefined);
      setError(
        caught instanceof Error ? caught.message : t("memory.loadFailed")
      );
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const loadMessages = getLoadMessages();
    requestMemory(
      memoryId,
      loadMessages.requestFailed,
      loadMessages.etagMissing,
      loadMessages.unavailable,
      controller.signal
    )
      .then((next) => {
        if (active) {
          applyLoaded(next);
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : loadMessages.loadFailed
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [memoryId, organizationSlug]);

  const changed = Boolean(
    loaded &&
      (title.trim() !== loaded.memory.title ||
        content.trim() !== loaded.memory.content)
  );

  async function saveRevision() {
    if (!loaded || !changed) {
      return;
    }
    setSaving(true);
    const controller = new AbortController();
    mutationRequest.current = controller;
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/memories/${memoryId}`,
        {
          method: "PATCH",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "If-Match": loaded.etag
          },
          body: JSON.stringify({
            ...(title.trim() !== loaded.memory.title
              ? { title: title.trim() }
              : {}),
            ...(content.trim() !== loaded.memory.content
              ? { content: content.trim() }
              : {}),
            ...(reason.trim() ? { changeReason: reason.trim() } : {})
          })
        }
      );
      if (response.status === 409) {
        throw new Error(
          t("memory.conflict")
        );
      }
      await responseOk(response, t("memory.requestFailed"));
      if (controller.signal.aborted || !mounted.current) return;
      onChanged();
      setMessage(t("memory.revisionSaved"));
      await loadMemory();
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      setError(
        caught instanceof Error ? caught.message : t("memory.revisionFailed")
      );
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function archive() {
    if (!loaded) {
      return;
    }
    setSaving(true);
    const controller = new AbortController();
    mutationRequest.current = controller;
    setError(undefined);
    setMessage(undefined);
    try {
      const query = reason.trim()
        ? `?reason=${encodeURIComponent(reason.trim())}`
        : "";
      const response = await fetch(
        `/api/memories/${memoryId}${query}`,
        { method: "DELETE", headers: { "If-Match": loaded.etag }, signal: controller.signal }
      );
      if (response.status === 409) {
        throw new Error(
          t("memory.conflict")
        );
      }
      await responseOk(response, t("memory.requestFailed"));
      if (controller.signal.aborted || !mounted.current) return;
      onChanged();
      setMessage(t("memory.archived"));
      setConfirmArchive(false);
      onClose();
    } catch (caught) {
      if (controller.signal.aborted || !mounted.current) return;
      setError(
        caught instanceof Error ? caught.message : t("memory.archiveFailed")
      );
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  const panel = (
      <div className={classes.shell}>
        {loading ? (
          <div className={classes.loading}><Loader /></div>
        ) : null}
        {error ? (
          <Alert
            color="red"
            title={t("memory.stateFailed")}
            withCloseButton
            onClose={() => setError(undefined)}
          >
            <Group justify="space-between">
              <Text size="sm">{error}</Text>
              <Button
                leftSection={<IconRefresh size={15} />}
                onClick={() => void loadMemory()}
                size="compact-sm"
                variant="light"
              >
                {t("memory.reload")}
              </Button>
            </Group>
          </Alert>
        ) : null}
        {message ? <Alert color="teal">{message}</Alert> : null}

        {loaded ? (
          <Stack gap="xl">
            <header className={classes.header}>
              <Stack gap="xs">
                <Group gap="xs">
                  <Badge variant="filled">v{loaded.memory.version}</Badge>
                  {loaded.memory.scope ? <Badge variant="outline">{t(`workspace.scope.${loaded.memory.scope.kind}`)}</Badge> : null}
                  <Badge color="gray" variant="light">
                    {loaded.memory.kind}
                  </Badge>
                  <Badge color="teal" variant="dot">
                    {loaded.memory.status}
                  </Badge>
                </Group>
                <Title order={2}>{loaded.memory.title}</Title>
                <Text c="dimmed" size="sm">
                  {formattedDate(loaded.memory.updatedAt, locale)} · {t("memory.source", { source: loaded.memory.source.type })}
                </Text>
              </Stack>
              <Text c="dimmed" ff="monospace" size="xs">
                {loaded.memory.id}
              </Text>
            </header>

            <Tabs defaultValue="content" keepMounted={false}>
              <Tabs.List mb="md">
                <Tabs.Tab value="content">{t("memoryUi.read")}</Tabs.Tab>
                {loaded.memory.capabilities.write || loaded.memory.capabilities.manage ? (
                  <Tabs.Tab value="edit">{t("memoryUi.edit")}</Tabs.Tab>
                ) : null}
                {loaded.memory.capabilities.manage ? (
                  <Tabs.Tab value="history">{t("memory.versionSpine")}</Tabs.Tab>
                ) : null}
              </Tabs.List>
              <Tabs.Panel value="content">
              <Paper className={classes.snapshot} p="md" withBorder>
                <Stack gap="lg">
                  <Text c="dimmed" fw={750} size="xs" tt="uppercase">
                    {t("memory.currentSnapshot")}
                  </Text>
                  <Text className={classes.content}>{loaded.memory.content}</Text>
                  <Divider />
                  <Text size="sm">{t("memory.source", { source: loaded.memory.source.type })}</Text>
                  {loaded.memory.source.uri ? <Text size="sm" style={{ overflowWrap: "anywhere" }}>{loaded.memory.source.uri}</Text> : null}
                  <Group grow>
                    <Stack gap={2}>
                      <Text c="dimmed" size="xs">{t("memory.validFrom")}</Text>
                      <Text size="sm">{formattedDate(loaded.memory.validFrom, locale)}</Text>
                    </Stack>
                    <Stack gap={2}>
                      <Text c="dimmed" size="xs">{t("memory.expires")}</Text>
                      <Text size="sm">
                        {loaded.memory.expiresAt
                          ? formattedDate(loaded.memory.expiresAt, locale)
                          : t("memory.noExpiration")}
                      </Text>
                    </Stack>
                  </Group>
                </Stack>
              </Paper>
              </Tabs.Panel>
              <Tabs.Panel value="edit">
              {loaded.memory.capabilities.write || loaded.memory.capabilities.manage ? (
              <Paper p="md" withBorder>
                <Stack gap="md">
                  <Stack gap={2}>
                    <Title order={3}>{t("memory.newRevision")}</Title>
                    <Text c="dimmed" size="sm">
                      {t("memory.revisionHint")}
                    </Text>
                  </Stack>
                  <TextInput
                    disabled={!loaded.memory.capabilities.write}
                    label={t("memory.title")}
                    maxLength={500}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                    value={title}
                  />
                  <Textarea
                    autosize
                    disabled={!loaded.memory.capabilities.write}
                    label={t("memory.content")}
                    maxLength={100_000}
                    minRows={7}
                    onChange={(event) => setContent(event.currentTarget.value)}
                    value={content}
                  />
                  <Textarea
                    autosize
                    label={t("memory.changeReason")}
                    maxLength={1_000}
                    minRows={2}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    placeholder={t("memory.changeReasonPlaceholder")}
                    value={reason}
                  />
                  <Group justify="space-between">
                    {loaded.memory.capabilities.manage ? (
                      <Button
                        color="red"
                        leftSection={<IconArchive size={16} />}
                        onClick={() => setConfirmArchive(true)}
                        variant="subtle"
                      >
                        Archive
                      </Button>
                    ) : <span />}
                    <Button
                      disabled={!loaded.memory.capabilities.write || !changed || !title.trim() || !content.trim()}
                      leftSection={<IconDeviceFloppy size={16} />}
                      loading={saving}
                      onClick={() => void saveRevision()}
                    >
                      {t("memory.saveRevision")}
                    </Button>
                  </Group>
                  {confirmArchive ? (
                    <Alert color="red" title={t("memory.archiveWarning")}>
                      <Stack gap="sm">
                        <Text size="sm">
                          {t("memory.archiveBody")}
                        </Text>
                        <Group justify="flex-end">
                          <Button
                            onClick={() => setConfirmArchive(false)}
                            size="compact-sm"
                            variant="default"
                          >
                            {t("memory.cancel")}
                          </Button>
                          <Button
                            color="red"
                            loading={saving}
                            onClick={() => void archive()}
                            size="compact-sm"
                          >
                            {t("memory.confirmArchive")}
                          </Button>
                        </Group>
                      </Stack>
                    </Alert>
                  ) : null}
                </Stack>
              </Paper>
              ) : null}
              </Tabs.Panel>
              <Tabs.Panel value="history">
            {loaded.memory.capabilities.manage ? (
              <section>
                <Stack gap="xs" mb="lg">
                  <Text c="brand" fw={750} size="xs" tt="uppercase">
                    {t("memory.versionSpine")}
                  </Text>
                  <Title order={2}>{t("memory.historyTitle")}</Title>
                </Stack>
                <div className={classes.timeline}>
                  <article className={classes.version} data-current>
                    <Badge color="brand">v{loaded.memory.version} · {t("memory.current")}</Badge>
                    <Text fw={700}>{loaded.memory.title}</Text>
                    <Text c="dimmed" lineClamp={3} size="sm">
                      {loaded.memory.content}
                    </Text>
                    <Text c="dimmed" ff="monospace" size="xs">
                      {t("memory.updated", { date: formattedDate(loaded.memory.updatedAt, locale) })}
                    </Text>
                  </article>
                  {loaded.versions.map((version) => (
                    <article className={classes.version} key={version.version}>
                      <Group justify="space-between">
                        <Badge color="gray" variant="light">v{version.version}</Badge>
                        <Text c="dimmed" size="xs">{version.status}</Text>
                      </Group>
                      <Text fw={700}>{version.title}</Text>
                      <Text c="dimmed" size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {version.content}
                      </Text>
                      {version.changeReason ? (
                        <Text className={classes.reason} size="sm">
                          “{version.changeReason}”
                        </Text>
                      ) : null}
                      <Text c="dimmed" ff="monospace" size="xs">
                        {version.changedBy} · {formattedDate(version.createdAt, locale)}
                      </Text>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
              </Tabs.Panel>
            </Tabs>
          </Stack>
        ) : null}
      </div>
  );

  return embedded ? panel : (
    <Modal attributes={{ content: { "aria-label": t("memory.lifecycle") } }} onClose={onClose} opened size="xl" title={<Text fw={650}>{t("memory.lifecycle")}</Text>}>
      {panel}
    </Modal>
  );
}
