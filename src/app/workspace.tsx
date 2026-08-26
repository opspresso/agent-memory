"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Code,
  CopyButton,
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
  IconBrain,
  IconCloudUpload,
  IconCheck,
  IconCopy,
  IconFileText,
  IconLogout,
  IconHistory,
  IconPlugConnected,
  IconSearch,
  IconShieldCheck,
  IconSettings,
  IconTopologyStar3
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { OrganizationMembership } from "@/domain/identity/organization-access-repository";
import { signOut } from "@/lib/auth-client";
import type { SessionUser } from "@/lib/session";

import { useT } from "./_i18n/provider";
import {
  contextResultPresentation,
  relativeRelevance
} from "./context-result-presentation";
import classes from "./page.module.css";
import {
  KnowledgeGraph,
  type KnowledgeGraphEdgeView,
  type KnowledgeGraphNodeView
} from "./knowledge-graph";
import { KnowledgeCandidateReview } from "./knowledge-candidate-review";
import { MemoryLifecycle } from "./memory-lifecycle";
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
  readonly origin: string;
  readonly organizations: readonly OrganizationMembership[];
  readonly user: SessionUser;
  readonly writableTeamsByOrganization: Readonly<
    Record<string, readonly TeamView[]>
  >;
}

type SearchKind =
  | "context/search"
  | "documents"
  | "knowledge/nodes"
  | "memories";

interface SearchResponse {
  readonly hits?: readonly Record<string, unknown>[];
  readonly error?: string;
}

interface NeighborhoodResponse {
  readonly nodes?: readonly KnowledgeGraphNodeView[];
  readonly edges?: readonly KnowledgeGraphEdgeView[];
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

function resultTitle(hit: Record<string, unknown>, fallback: string): string {
  const memory = nestedRecord(hit, "memory");
  const document = nestedRecord(hit, "document");
  const node = nestedRecord(hit, "node");
  return String(
    memory?.title ?? document?.title ?? node?.canonicalName ?? fallback
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
  return `${String(source?.id ?? "result")}:${String(chunk?.id ?? "root")}`;
}

export function Workspace({
  administrationByOrganization,
  origin,
  organizations,
  user,
  writableTeamsByOrganization
}: WorkspaceProps) {
  const t = useT();
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id ?? ""
  );
  const [searchKind, setSearchKind] = useState<SearchKind>("context/search");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [hits, setHits] = useState<readonly Record<string, unknown>[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string>();
  const [graphCenterNodeId, setGraphCenterNodeId] = useState<string>();
  const [graphSelectedNodeId, setGraphSelectedNodeId] = useState<string>();
  const [graphNodes, setGraphNodes] = useState<
    readonly KnowledgeGraphNodeView[]
  >([]);
  const [graphEdges, setGraphEdges] = useState<
    readonly KnowledgeGraphEdgeView[]
  >([]);
  const [graphError, setGraphError] = useState<string>();
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [signOutError, setSignOutError] = useState<string>();
  const [signingOut, setSigningOut] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string>();
  const [documentScopeKind, setDocumentScopeKind] = useState<
    "organization" | "team" | "user"
  >("user");
  const [documentTeamId, setDocumentTeamId] = useState<string | null>(null);
  const graphRequest = useRef<AbortController | undefined>(undefined);
  const searchRequest = useRef<AbortController | undefined>(undefined);

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === organizationId),
    [organizationId, organizations]
  );
  const writableTeams = writableTeamsByOrganization[organizationId] ?? [];
  const peakScore = useMemo(
    () =>
      Math.max(
        0,
        ...hits.map((hit) =>
          typeof hit.score === "number" && Number.isFinite(hit.score)
            ? hit.score
            : 0
        )
      ),
    [hits]
  );
  const mcpEndpoint = organizationId && origin
    ? `${origin}/api/organizations/${organizationId}/mcp`
    : t("workspace.selectOrganization");

  useEffect(
    () => () => {
      graphRequest.current?.abort();
      searchRequest.current?.abort();
    },
    []
  );

  function cancelSearchRequests() {
    graphRequest.current?.abort();
    graphRequest.current = undefined;
    searchRequest.current?.abort();
    searchRequest.current = undefined;
    setSearching(false);
    setLoadingGraph(false);
  }

  function selectOrganization(value: string | null) {
    if (!value) {
      return;
    }
    cancelSearchRequests();
    setOrganizationId(value);
    setHits([]);
    setSelectedMemoryId(undefined);
    setSearchError(undefined);
    setGraphCenterNodeId(undefined);
    setGraphSelectedNodeId(undefined);
    setGraphNodes([]);
    setGraphEdges([]);
    setGraphError(undefined);
    setDocumentScopeKind("user");
    setDocumentTeamId(null);
  }

  function selectSearchKind(value: string) {
    cancelSearchRequests();
    setSearchKind(value as SearchKind);
    setHits([]);
    setSearchError(undefined);
    setGraphCenterNodeId(undefined);
    setGraphSelectedNodeId(undefined);
    setGraphNodes([]);
    setGraphEdges([]);
    setGraphError(undefined);
  }

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
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setSearchError(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/${searchKind}?q=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      );
      const body = (await response.json()) as SearchResponse;
      if (!response.ok) {
        throw new Error(body.error ?? t("workspace.searchFailed"));
      }
      setHits(body.hits ?? []);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      setSearchError(
        caught instanceof Error ? caught.message : t("workspace.searchFailed")
      );
      setHits([]);
    } finally {
      if (searchRequest.current === controller) {
        searchRequest.current = undefined;
        setSearching(false);
      }
    }
  }

  async function exploreKnowledgeNode(nodeId: string) {
    if (!organizationId) {
      return;
    }
    graphRequest.current?.abort();
    const controller = new AbortController();
    graphRequest.current = controller;
    setLoadingGraph(true);
    setGraphError(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/knowledge/nodes/${nodeId}/neighborhood?depth=2&limit=100`,
        { signal: controller.signal }
      );
      const body = (await response.json()) as NeighborhoodResponse;
      if (!response.ok) {
        throw new Error(body.error ?? t("workspace.graphFailed"));
      }
      setGraphCenterNodeId(nodeId);
      setGraphSelectedNodeId(nodeId);
      setGraphNodes(body.nodes ?? []);
      setGraphEdges(body.edges ?? []);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      setGraphError(
        caught instanceof Error
          ? caught.message
          : t("workspace.graphFailed")
      );
    } finally {
      if (graphRequest.current === controller) {
        graphRequest.current = undefined;
        setLoadingGraph(false);
      }
    }
  }

  function selectKnowledgeNode(nodeId: string) {
    setGraphSelectedNodeId(nodeId);
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
    form.set("scopeKind", documentScopeKind);
    if (documentScopeKind === "team" && documentTeamId) {
      form.set("teamId", documentTeamId);
    }
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/documents`,
        { method: "POST", body: form }
      );
      const body = (await response.json()) as {
        id?: string;
        error?: string;
        status?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? t("workspace.uploadFailed"));
      }
      setUploadMessage(
        body.status === "failed"
          ? t("workspace.uploadQueueFailed", { id: body.id ?? "" })
          : t("workspace.uploadQueued", { id: body.id ?? "" })
      );
      formElement.reset();
    } catch (caught) {
      setUploadMessage(
        caught instanceof Error ? caught.message : t("workspace.uploadFailed")
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(undefined);
    try {
      const result = await signOut();
      if (result.error) {
        throw new Error(result.error.message ?? t("workspace.signOutFailed"));
      }
      router.refresh();
    } catch (caught) {
      setSignOutError(
        caught instanceof Error ? caught.message : t("workspace.signOutFailed")
      );
      setSigningOut(false);
    }
  }

  return (
    <main className={classes.workspace}>
      <Group align="flex-end" justify="space-between">
        <Stack gap={4}>
          <Text c="dimmed" size="sm">
            {t("workspace.eyebrow")}
          </Text>
          <Title order={1}>{t("workspace.title")}</Title>
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
            aria-label={t("workspace.signOut")}
            leftSection={<IconLogout size={16} />}
            loading={signingOut}
            onClick={() => void handleSignOut()}
            variant="subtle"
          >
            {t("workspace.signOut")}
          </Button>
        </Group>
      </Group>
      {signOutError ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {signOutError}
        </Alert>
      ) : null}

      {organizations.length === 0 ? (
        <Stack gap="lg">
          <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
            {t("workspace.noOrganization")} {user.isAdmin
              ? t("workspace.createFirst")
              : t("workspace.requestMembership")}
          </Alert>
          {user.isAdmin ? <OrganizationBootstrap /> : null}
        </Stack>
      ) : (
        <Paper p="md" radius="lg" withBorder>
          <Group justify="space-between">
            <Select
              data={organizations.map((organization) => ({
                value: organization.id,
                label: organization.name
              }))}
              label={t("workspace.activeOrganization")}
              onChange={selectOrganization}
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
            {t("workspace.tab.search")}
          </Tabs.Tab>
          <Tabs.Tab leftSection={<IconCloudUpload size={16} />} value="upload">
            {t("workspace.tab.upload")}
          </Tabs.Tab>
          <Tabs.Tab leftSection={<IconPlugConnected size={16} />} value="connect">
            {t("workspace.tab.connect")}
          </Tabs.Tab>
          <Tabs.Tab leftSection={<IconShieldCheck size={16} />} value="review">
            {t("workspace.tab.review")}
          </Tabs.Tab>
          {selectedOrganization?.role === "admin" ||
          selectedOrganization?.role === "owner" ? (
            <Tabs.Tab leftSection={<IconSettings size={16} />} value="manage">
              {t("workspace.tab.manage")}
            </Tabs.Tab>
          ) : null}
        </Tabs.List>

        <Tabs.Panel pt="lg" value="search">
          <Paper p="lg" radius="lg" withBorder>
            <Stack gap="lg">
              <SegmentedControl
                data={[
                  { label: "All Context", value: "context/search" },
                  { label: "Memory", value: "memories" },
                  { label: "Documents", value: "documents" },
                  { label: "Graph", value: "knowledge/nodes" }
                ]}
                onChange={selectSearchKind}
                value={searchKind}
              />
              <form onSubmit={search}>
                <TextInput
                  disabled={!organizationId}
                  leftSection={<IconSearch size={17} />}
                  name="query"
                  placeholder={t("workspace.searchPlaceholder")}
                  rightSection={
                    <Button loading={searching} size="compact-sm" type="submit">
                      {t("workspace.search")}
                    </Button>
                  }
                  rightSectionWidth={76}
                  size="md"
                />
              </form>
              {searchError ? <Alert color="red">{searchError}</Alert> : null}
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                {hits.map((hit) => {
                  const node = nestedRecord(hit, "node");
                  const memory = nestedRecord(hit, "memory");
                  const presentation = contextResultPresentation(hit, t);
                  const relevance = relativeRelevance(
                    presentation.score,
                    peakScore
                  );
                  const capabilities = memory?.capabilities;
                  const canManageMemory =
                    capabilities && typeof capabilities === "object"
                      ? Boolean(
                          (capabilities as Record<string, unknown>).write ||
                            (capabilities as Record<string, unknown>).manage
                        )
                      : false;
                  return (
                    <Paper
                      className={classes.resultCard}
                      data-source={presentation.sourceType}
                      key={resultKey(hit)}
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
                      {searchKind === "knowledge/nodes" &&
                      typeof node?.id === "string" ? (
                        <Button
                          leftSection={<IconTopologyStar3 size={16} />}
                          loading={loadingGraph}
                          onClick={() =>
                            void exploreKnowledgeNode(node.id as string)
                          }
                          size="compact-sm"
                          variant="light"
                        >
                          {t("workspace.viewRelationships")}
                        </Button>
                      ) : null}
                      {typeof memory?.id === "string" && canManageMemory ? (
                        <Button
                          leftSection={<IconHistory size={16} />}
                          onClick={() => setSelectedMemoryId(memory.id as string)}
                          size="compact-sm"
                          variant="light"
                        >
                          Lifecycle
                        </Button>
                      ) : null}
                      </Stack>
                    </Paper>
                  );
                })}
              </SimpleGrid>
              {!searching && hits.length === 0 && !searchError ? (
                <Text c="dimmed" ta="center">
                  {t("workspace.searchEmpty")}
                </Text>
              ) : null}
              {graphError ? <Alert color="red">{graphError}</Alert> : null}
              {graphCenterNodeId && graphNodes.length > 0 ? (
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Stack gap={2}>
                      <Text c="indigo" fw={750} size="xs" tt="uppercase">
                        {t("workspace.mapEyebrow")}
                      </Text>
                      <Title order={2}>{t("workspace.mapTitle")}</Title>
                    </Stack>
                    <Badge variant="light">
                      {t("workspace.mapCount", {
                        nodes: graphNodes.length,
                        edges: graphEdges.length
                      })}
                    </Badge>
                  </Group>
                  <KnowledgeGraph
                    centerNodeId={graphCenterNodeId}
                    edges={graphEdges}
                    nodes={graphNodes}
                    onExploreNode={(nodeId) => void exploreKnowledgeNode(nodeId)}
                    onSelectNode={selectKnowledgeNode}
                    selectedNodeId={graphSelectedNodeId ?? graphCenterNodeId}
                  />
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel pt="lg" value="upload">
          <Paper p="lg" radius="lg" withBorder>
            <form onSubmit={upload}>
              <Stack gap="md">
                <Stack gap={2}>
                  <Title order={3}>{t("workspace.uploadTitle")}</Title>
                  <Text c="dimmed" size="sm">
                    {t("workspace.uploadFormats")}
                  </Text>
                </Stack>
                <Select
                  allowDeselect={false}
                  data={[
                    { label: t("workspace.scope.user"), value: "user" },
                    ...(writableTeams.length > 0
                      ? [{ label: t("workspace.scope.team"), value: "team" }]
                      : []),
                    ...(selectedOrganization?.role === "admin" ||
                    selectedOrganization?.role === "owner"
                      ? [{ label: t("workspace.scope.organization"), value: "organization" }]
                      : [])
                  ]}
                  label={t("workspace.scopeLabel")}
                  onChange={(value) => {
                    if (
                      value === "organization" ||
                      value === "team" ||
                      value === "user"
                    ) {
                      setDocumentScopeKind(value);
                      setDocumentTeamId(null);
                    }
                  }}
                  value={documentScopeKind}
                />
                {documentScopeKind === "team" ? (
                  <Select
                    allowDeselect={false}
                    data={writableTeams.map((team) => ({
                      label: team.name,
                      value: team.id
                    }))}
                    label={t("workspace.shareTeam")}
                    onChange={setDocumentTeamId}
                    placeholder={t("workspace.selectTeam")}
                    required
                    value={documentTeamId}
                  />
                ) : null}
                <TextInput
                  label={t("workspace.documentTitle")}
                  name="title"
                  placeholder={t("workspace.documentTitlePlaceholder")}
                />
                <input
                  accept=".txt,.md,.json,.xml,.csv,text/plain,text/markdown,application/json"
                  aria-label={t("workspace.documentFile")}
                  name="file"
                  required
                  type="file"
                />
                <Button
                  disabled={
                    !organizationId ||
                    (documentScopeKind === "team" && !documentTeamId)
                  }
                  leftSection={<IconCloudUpload size={17} />}
                  loading={uploading}
                  type="submit"
                >
                  {t("workspace.startIngestion")}
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
                {t("workspace.mcpBody")}
              </Text>
              <Group align="stretch" gap="xs" wrap="nowrap">
                <Code block style={{ flex: 1, overflowWrap: "anywhere" }}>
                  {mcpEndpoint}
                </Code>
                <CopyButton value={mcpEndpoint}>
                  {({ copied, copy }) => (
                    <Button
                      aria-label={t("workspace.copyEndpoint")}
                      color={copied ? "teal" : "indigo"}
                      disabled={!organizationId || !origin}
                      leftSection={
                        copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                      }
                      onClick={copy}
                      variant="light"
                    >
                      {copied ? t("workspace.copied") : t("workspace.copy")}
                    </Button>
                  )}
                </CopyButton>
              </Group>
              <Text c="dimmed" size="sm">
                context_search · memory_search · memory_create · document_search ·
                knowledge_search · knowledge_neighborhood
              </Text>
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel pt="lg" value="review">
          <KnowledgeCandidateReview
            key={organizationId}
            organizationId={organizationId}
          />
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
      {selectedMemoryId ? (
        <MemoryLifecycle
          memoryId={selectedMemoryId}
          onClose={() => setSelectedMemoryId(undefined)}
          organizationId={organizationId}
        />
      ) : null}
    </main>
  );
}
