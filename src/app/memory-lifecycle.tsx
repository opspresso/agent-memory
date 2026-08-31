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
import { useEffect, useEffectEvent, useState } from "react";

import { useLocale, useT } from "./_i18n/provider";
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
  readonly memoryId: string;
  readonly onClose: () => void;
  readonly organizationSlug: string;
}

interface LoadedMemory {
  readonly etag: string;
  readonly memory: MemoryDetailView;
  readonly versions: readonly MemoryVersionView[];
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? fallback;
}

async function requestMemory(
  organizationSlug: string,
  memoryId: string,
  fallback: string,
  etagMissing: string
): Promise<LoadedMemory> {
  const response = await fetch(
    `/api/organizations/${organizationSlug}/memories/${memoryId}`
  );
  if (!response.ok) {
    throw new Error(await responseError(response, fallback));
  }
  const memory = (await response.json()) as MemoryDetailView;
  const etag = response.headers.get("etag");
  if (!etag) {
    throw new Error(etagMissing);
  }
  if (!memory.capabilities.manage) {
    return { memory, etag, versions: [] };
  }
  const versionsResponse = await fetch(
    `/api/organizations/${organizationSlug}/memories/${memoryId}/versions?limit=100`
  );
  if (!versionsResponse.ok) {
    throw new Error(await responseError(versionsResponse, fallback));
  }
  const versionsBody = (await versionsResponse.json()) as {
    versions?: readonly MemoryVersionView[];
  };
  return { memory, etag, versions: versionsBody.versions ?? [] };
}

function formattedDate(value: string, locale: "en" | "ko") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function MemoryLifecycle({
  memoryId,
  onClose,
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
  const getLoadMessages = useEffectEvent(() => ({
    requestFailed: t("memory.requestFailed"),
    etagMissing: t("memory.etagMissing"),
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
    setLoading(true);
    setError(undefined);
    try {
      applyLoaded(await requestMemory(
        organizationSlug,
        memoryId,
        t("memory.requestFailed"),
        t("memory.etagMissing")
      ));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("memory.loadFailed")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const loadMessages = getLoadMessages();
    requestMemory(
      organizationSlug,
      memoryId,
      loadMessages.requestFailed,
      loadMessages.etagMissing
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
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationSlug}/memories/${memoryId}`,
        {
          method: "PATCH",
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
      if (!response.ok) {
        throw new Error(await responseError(response, t("memory.requestFailed")));
      }
      setMessage(t("memory.revisionSaved"));
      await loadMemory();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("memory.revisionFailed")
      );
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!loaded) {
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const query = reason.trim()
        ? `?reason=${encodeURIComponent(reason.trim())}`
        : "";
      const response = await fetch(
        `/api/organizations/${organizationSlug}/memories/${memoryId}${query}`,
        { method: "DELETE", headers: { "If-Match": loaded.etag } }
      );
      if (response.status === 409) {
        throw new Error(
          t("memory.conflict")
        );
      }
      if (!response.ok) {
        throw new Error(await responseError(response, t("memory.requestFailed")));
      }
      setMessage(t("memory.archived"));
      setConfirmArchive(false);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("memory.archiveFailed")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      fullScreen
      onClose={onClose}
      opened
      padding={0}
      title={<Text fw={750}>{t("memory.lifecycle")}</Text>}
    >
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
                  <Badge color="gray" variant="light">
                    {loaded.memory.kind}
                  </Badge>
                  <Badge color="teal" variant="dot">
                    {loaded.memory.status}
                  </Badge>
                </Group>
                <Title order={1}>{loaded.memory.title}</Title>
                <Text c="dimmed" size="sm">
                  {formattedDate(loaded.memory.updatedAt, locale)} · {t("memory.source", { source: loaded.memory.source.type })}
                </Text>
              </Stack>
              <Text c="dimmed" ff="monospace" size="xs">
                {loaded.memory.id}
              </Text>
            </header>

            <div className={classes.editorGrid}>
              <Paper className={classes.snapshot} p="xl" radius="lg">
                <Stack gap="lg">
                  <Text c="dimmed" fw={750} size="xs" tt="uppercase">
                    {t("memory.currentSnapshot")}
                  </Text>
                  <Text className={classes.content}>{loaded.memory.content}</Text>
                  <Divider />
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

              <Paper p="xl" radius="lg" withBorder>
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
                      disabled={!changed || !title.trim() || !content.trim()}
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
            </div>

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
                      <Text c="dimmed" lineClamp={3} size="sm">
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
          </Stack>
        ) : null}
      </div>
    </Modal>
  );
}
