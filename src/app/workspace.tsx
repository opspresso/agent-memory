"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCloudUpload,
  IconLogout,
  IconPlugConnected,
  IconSearch,
  IconSettings
} from "@tabler/icons-react";
import { useMemo, useState, type FormEvent } from "react";

import type { OrganizationMembership } from "@/domain/identity/organization-access-repository";
import type { SessionUser } from "@/lib/session";

import classes from "./page.module.css";
import { OrganizationBootstrap } from "./organization-bootstrap";
import {
  OrganizationManagement,
  type OrganizationMemberView,
  type TeamView
} from "./organization-management";

interface OrganizationAdministrationView {
  readonly members: readonly OrganizationMemberView[];
  readonly teams: readonly TeamView[];
}

interface WorkspaceProps {
  readonly administrationByOrganization: Readonly<
    Record<string, OrganizationAdministrationView>
  >;
  readonly organizations: readonly OrganizationMembership[];
  readonly user: SessionUser;
}

type SearchKind = "documents" | "knowledge/nodes" | "memories";

interface SearchResponse {
  readonly hits?: readonly Record<string, unknown>[];
  readonly error?: string;
}

function nestedRecord(
  hit: Record<string, unknown>,
  key: "chunk" | "document" | "memory" | "node"
): Record<string, unknown> | undefined {
  const value = hit[key];
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function resultTitle(hit: Record<string, unknown>): string {
  const memory = nestedRecord(hit, "memory");
  const document = nestedRecord(hit, "document");
  const node = nestedRecord(hit, "node");
  return String(
    memory?.title ?? document?.title ?? node?.canonicalName ?? "검색 결과"
  );
}

function resultSummary(hit: Record<string, unknown>): string {
  const memory = nestedRecord(hit, "memory");
  const chunk = nestedRecord(hit, "chunk");
  const node = nestedRecord(hit, "node");
  return String(
    memory?.content ?? chunk?.content ?? node?.summary ?? node?.kind ?? ""
  );
}

function resultKey(hit: Record<string, unknown>): string {
  const source =
    nestedRecord(hit, "memory") ??
    nestedRecord(hit, "document") ??
    nestedRecord(hit, "node");
  const chunk = nestedRecord(hit, "chunk");
  return `${String(source?.id ?? resultTitle(hit))}:${String(chunk?.id ?? "root")}`;
}

export function Workspace({
  administrationByOrganization,
  organizations,
  user
}: WorkspaceProps) {
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? ""
  );
  const [searchKind, setSearchKind] = useState<SearchKind>("memories");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [hits, setHits] = useState<readonly Record<string, unknown>[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string>();

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === organizationId),
    [organizationId, organizations]
  );
  const mcpPath = organizationId
    ? `/api/organizations/${organizationId}/mcp`
    : "조직을 선택하세요";

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const query = String(form.get("query") ?? "").trim();
    if (!query) {
      return;
    }
    setSearching(true);
    setSearchError(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/${searchKind}?q=${encodeURIComponent(query)}`
      );
      const body = (await response.json()) as SearchResponse;
      if (!response.ok) {
        throw new Error(body.error ?? "검색에 실패했습니다.");
      }
      setHits(body.hits ?? []);
    } catch (caught) {
      setSearchError(
        caught instanceof Error ? caught.message : "검색에 실패했습니다."
      );
      setHits([]);
    } finally {
      setSearching(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    setUploading(true);
    setUploadMessage(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("scopeKind", "user");
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/documents`,
        { method: "POST", body: form }
      );
      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "업로드에 실패했습니다.");
      }
      setUploadMessage(`수집 대기열에 등록했습니다: ${body.id}`);
      formElement.reset();
    } catch (caught) {
      setUploadMessage(
        caught instanceof Error ? caught.message : "업로드에 실패했습니다."
      );
    } finally {
      setUploading(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className={classes.workspace}>
      <Group align="flex-end" justify="space-between">
        <Stack gap={4}>
          <Text c="dimmed" size="sm">
            운영 콘솔
          </Text>
          <Title order={1}>공유 Context를 한곳에서 관리합니다.</Title>
        </Stack>
        <Group>
          <Avatar color="indigo" name={user.name} radius="xl" />
          <Stack gap={0} visibleFrom="sm">
            <Text fw={600} size="sm">
              {user.name}
            </Text>
            <Text c="dimmed" size="xs">
              {user.email}
            </Text>
          </Stack>
          <Button
            aria-label="로그아웃"
            leftSection={<IconLogout size={16} />}
            onClick={signOut}
            variant="subtle"
          >
            로그아웃
          </Button>
        </Group>
      </Group>

      {organizations.length === 0 ? (
        <Stack gap="lg">
          <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
            접근 가능한 조직이 없습니다. 첫 조직을 만들거나 관리자에게
            멤버십을 요청하세요.
          </Alert>
          <OrganizationBootstrap />
        </Stack>
      ) : (
        <Paper p="md" radius="lg" withBorder>
          <Group justify="space-between">
            <Select
              data={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name
              }))}
              label="활성 조직"
              onChange={(value) => value && setOrganizationId(value)}
              value={organizationId}
            />
            {selectedOrganization ? (
              <Group gap="xs">
                <Badge variant="light">{selectedOrganization.slug}</Badge>
                <Badge color="gray" variant="outline">
                  {selectedOrganization.role}
                </Badge>
              </Group>
            ) : null}
          </Group>
        </Paper>
      )}

      {organizations.length > 0 ? (
        <Tabs defaultValue="search" keepMounted={false} variant="pills">
        <Tabs.List>
          <Tabs.Tab leftSection={<IconSearch size={16} />} value="search">
            통합 검색
          </Tabs.Tab>
          <Tabs.Tab leftSection={<IconCloudUpload size={16} />} value="upload">
            문서 수집
          </Tabs.Tab>
          <Tabs.Tab leftSection={<IconPlugConnected size={16} />} value="connect">
            Agent 연결
          </Tabs.Tab>
          {selectedOrganization?.role === "admin" ||
          selectedOrganization?.role === "owner" ? (
            <Tabs.Tab leftSection={<IconSettings size={16} />} value="manage">
              조직 관리
            </Tabs.Tab>
          ) : null}
        </Tabs.List>

        <Tabs.Panel pt="lg" value="search">
          <Paper p="lg" radius="lg" withBorder>
            <Stack gap="lg">
              <SegmentedControl
                data={[
                  { label: "Memory", value: "memories" },
                  { label: "Documents", value: "documents" },
                  { label: "Graph", value: "knowledge/nodes" }
                ]}
                onChange={(value) => setSearchKind(value as SearchKind)}
                value={searchKind}
              />
              <form onSubmit={search}>
                <TextInput
                  disabled={!organizationId}
                  leftSection={<IconSearch size={17} />}
                  name="query"
                  placeholder="정책, 장애 대응, 시스템 관계를 검색하세요"
                  rightSection={
                    <Button loading={searching} size="compact-sm" type="submit">
                      검색
                    </Button>
                  }
                  rightSectionWidth={76}
                  size="md"
                />
              </form>
              {searchError ? <Alert color="red">{searchError}</Alert> : null}
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                {hits.map((hit) => (
                  <Paper key={resultKey(hit)} p="md" withBorder>
                    <Stack gap="xs">
                      <Group justify="space-between">
                        <Text fw={650}>{resultTitle(hit)}</Text>
                        {typeof hit.score === "number" ? (
                          <Badge variant="light">{hit.score.toFixed(3)}</Badge>
                        ) : null}
                      </Group>
                      <Text c="dimmed" lineClamp={4} size="sm">
                        {resultSummary(hit)}
                      </Text>
                    </Stack>
                  </Paper>
                ))}
              </SimpleGrid>
              {!searching && hits.length === 0 && !searchError ? (
                <Text c="dimmed" ta="center">
                  검색어를 입력하면 권한 범위 안의 Context가 표시됩니다.
                </Text>
              ) : null}
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel pt="lg" value="upload">
          <Paper p="lg" radius="lg" withBorder>
            <form onSubmit={upload}>
              <Stack gap="md">
                <Stack gap={2}>
                  <Title order={3}>개인 범위 문서 수집</Title>
                  <Text c="dimmed" size="sm">
                    UTF-8 text, Markdown, JSON, XML, CSV · 최대 10 MiB
                  </Text>
                </Stack>
                <TextInput
                  label="문서 제목"
                  name="title"
                  placeholder="파일명을 기본값으로 사용"
                />
                <input
                  accept=".txt,.md,.json,.xml,.csv,text/plain,text/markdown,application/json"
                  aria-label="문서 파일"
                  name="file"
                  required
                  type="file"
                />
                <Button
                  disabled={!organizationId}
                  leftSection={<IconCloudUpload size={17} />}
                  loading={uploading}
                  type="submit"
                >
                  수집 시작
                </Button>
                {uploadMessage ? <Alert>{uploadMessage}</Alert> : null}
              </Stack>
            </form>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel pt="lg" value="connect">
          <Paper p="lg" radius="lg" withBorder>
            <Stack gap="md">
              <Title order={3}>Streamable HTTP MCP</Title>
              <Text c="dimmed">
                Better Auth 로그인 응답의 <Code>set-auth-token</Code> 값을 Bearer
                token으로 전달하세요.
              </Text>
              <Code block>{mcpPath}</Code>
              <Text c="dimmed" size="sm">
                memory_search · memory_create · document_search · knowledge_search ·
                knowledge_neighborhood
              </Text>
            </Stack>
          </Paper>
        </Tabs.Panel>

        {selectedOrganization?.role === "admin" ||
        selectedOrganization?.role === "owner" ? (
          <Tabs.Panel pt="lg" value="manage">
            <OrganizationManagement
              initialMembers={
                administrationByOrganization[organizationId]?.members ?? []
              }
              initialTeams={
                administrationByOrganization[organizationId]?.teams ?? []
              }
              key={organizationId}
              organizationId={organizationId}
            />
          </Tabs.Panel>
        ) : null}
        </Tabs>
      ) : null}
    </main>
  );
}
