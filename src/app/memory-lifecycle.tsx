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
import { useEffect, useState } from "react";

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
  readonly organizationId: string;
}

interface LoadedMemory {
  readonly etag: string;
  readonly memory: MemoryDetailView;
  readonly versions: readonly MemoryVersionView[];
}

async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "Memory 요청을 처리하지 못했습니다.";
}

async function requestMemory(
  organizationId: string,
  memoryId: string
): Promise<LoadedMemory> {
  const response = await fetch(
    `/api/organizations/${organizationId}/memories/${memoryId}`
  );
  if (!response.ok) {
    throw new Error(await responseError(response));
  }
  const memory = (await response.json()) as MemoryDetailView;
  const etag = response.headers.get("etag");
  if (!etag) {
    throw new Error("Memory version header가 없습니다.");
  }
  if (!memory.capabilities.manage) {
    return { memory, etag, versions: [] };
  }
  const versionsResponse = await fetch(
    `/api/organizations/${organizationId}/memories/${memoryId}/versions?limit=100`
  );
  if (!versionsResponse.ok) {
    throw new Error(await responseError(versionsResponse));
  }
  const versionsBody = (await versionsResponse.json()) as {
    versions?: readonly MemoryVersionView[];
  };
  return { memory, etag, versions: versionsBody.versions ?? [] };
}

function formattedDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function MemoryLifecycle({
  memoryId,
  onClose,
  organizationId
}: MemoryLifecycleProps) {
  const [loaded, setLoaded] = useState<LoadedMemory>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [confirmArchive, setConfirmArchive] = useState(false);

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
      applyLoaded(await requestMemory(organizationId, memoryId));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Memory를 불러오지 못했습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    requestMemory(organizationId, memoryId)
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
              : "Memory를 불러오지 못했습니다."
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [memoryId, organizationId]);

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
        `/api/organizations/${organizationId}/memories/${memoryId}`,
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
          "다른 사용자가 먼저 수정했습니다. 최신 version을 다시 불러오세요."
        );
      }
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setMessage("새 revision을 저장했습니다.");
      await loadMemory();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Revision을 저장하지 못했습니다."
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
        `/api/organizations/${organizationId}/memories/${memoryId}${query}`,
        { method: "DELETE", headers: { "If-Match": loaded.etag } }
      );
      if (response.status === 409) {
        throw new Error(
          "다른 사용자가 먼저 수정했습니다. 최신 version을 다시 불러오세요."
        );
      }
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setMessage("Memory를 archive했습니다.");
      setConfirmArchive(false);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Memory를 archive하지 못했습니다."
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
      title={<Text fw={750}>Memory lifecycle</Text>}
    >
      <div className={classes.shell}>
        {loading ? (
          <div className={classes.loading}><Loader /></div>
        ) : null}
        {error ? (
          <Alert
            color="red"
            title="현재 상태를 반영하지 못했습니다."
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
                다시 불러오기
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
                  {formattedDate(loaded.memory.updatedAt)} · source {loaded.memory.source.type}
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
                    Current snapshot
                  </Text>
                  <Text className={classes.content}>{loaded.memory.content}</Text>
                  <Divider />
                  <Group grow>
                    <Stack gap={2}>
                      <Text c="dimmed" size="xs">유효 시작</Text>
                      <Text size="sm">{formattedDate(loaded.memory.validFrom)}</Text>
                    </Stack>
                    <Stack gap={2}>
                      <Text c="dimmed" size="xs">만료</Text>
                      <Text size="sm">
                        {loaded.memory.expiresAt
                          ? formattedDate(loaded.memory.expiresAt)
                          : "기한 없음"}
                      </Text>
                    </Stack>
                  </Group>
                </Stack>
              </Paper>

              <Paper p="xl" radius="lg" withBorder>
                <Stack gap="md">
                  <Stack gap={2}>
                    <Title order={3}>새 revision</Title>
                    <Text c="dimmed" size="sm">
                      저장 시 현재 version을 기준으로 충돌을 확인합니다.
                    </Text>
                  </Stack>
                  <TextInput
                    disabled={!loaded.memory.capabilities.write}
                    label="제목"
                    maxLength={500}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                    value={title}
                  />
                  <Textarea
                    autosize
                    disabled={!loaded.memory.capabilities.write}
                    label="내용"
                    maxLength={100_000}
                    minRows={7}
                    onChange={(event) => setContent(event.currentTarget.value)}
                    value={content}
                  />
                  <Textarea
                    autosize
                    label="변경 사유"
                    maxLength={1_000}
                    minRows={2}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    placeholder="다음 사용자가 변경 맥락을 이해할 수 있게 기록하세요"
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
                      Revision 저장
                    </Button>
                  </Group>
                  {confirmArchive ? (
                    <Alert color="red" title="검색에서 Memory를 제외합니다.">
                      <Stack gap="sm">
                        <Text size="sm">
                          Archive는 새 version으로 기록되며 현재 검색 결과에서 사라집니다.
                        </Text>
                        <Group justify="flex-end">
                          <Button
                            onClick={() => setConfirmArchive(false)}
                            size="compact-sm"
                            variant="default"
                          >
                            취소
                          </Button>
                          <Button
                            color="red"
                            loading={saving}
                            onClick={() => void archive()}
                            size="compact-sm"
                          >
                            Archive 확인
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
                  <Text c="indigo" fw={750} size="xs" tt="uppercase">
                    Version spine
                  </Text>
                  <Title order={2}>변경 맥락을 시간순으로 추적합니다.</Title>
                </Stack>
                <div className={classes.timeline}>
                  <article className={classes.version} data-current>
                    <Badge color="indigo">v{loaded.memory.version} · current</Badge>
                    <Text fw={700}>{loaded.memory.title}</Text>
                    <Text c="dimmed" lineClamp={3} size="sm">
                      {loaded.memory.content}
                    </Text>
                    <Text c="dimmed" ff="monospace" size="xs">
                      updated {formattedDate(loaded.memory.updatedAt)}
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
                        {version.changedBy} · {formattedDate(version.createdAt)}
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
