"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title
} from "@mantine/core";
import {
  IconAlertCircle,
  IconArchive,
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
  IconTopologyStar3,
  IconTrash
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  canAccessScopedResource,
  type OrganizationAccess,
  type ScopedResource
} from "@/domain/identity/organization-access";
import type { OrganizationMembership } from "@/domain/identity/organization-access-repository";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";
import { signOut } from "@/lib/auth-client";
import type { SessionUser } from "@/lib/session";

import { useT } from "./_i18n/provider";
import {
  contextResultPresentation,
  relativeRelevance
} from "./context-result-presentation";
import { responseJson } from "./http-response";
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
  readonly accessByOrganization: Readonly<Record<string, OrganizationAccess>>;
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

type PendingResourceAction =
  | Readonly<{ kind: "document"; id: string; name: string }>
  | Readonly<{ kind: "edge"; id: string; name: string }>
  | Readonly<{ kind: "node"; id: string; name: string }>
  | Readonly<{
      kind: "merge";
      targetNodeId: string;
      sourceNodeId: string;
      name: string;
    }>;

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

function scopedResource(value: unknown): ScopedResource | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const scope = value as Record<string, unknown>;
  if (typeof scope.organizationId !== "string") {
    return undefined;
  }
  if (scope.kind === "organization") {
    return { kind: "organization", organizationId: scope.organizationId };
  }
  if (scope.kind === "team" && typeof scope.teamId === "string") {
    return {
      kind: "team",
      organizationId: scope.organizationId,
      teamId: scope.teamId
    };
  }
  if (scope.kind === "user" && typeof scope.userId === "string") {
    return {
      kind: "user",
      organizationId: scope.organizationId,
      userId: scope.userId
    };
  }
  return undefined;
}

function sameScope(left: unknown, right: unknown): boolean {
  const leftScope = scopedResource(left);
  const rightScope = scopedResource(right);
  return Boolean(
    leftScope &&
      rightScope &&
      leftScope.kind === rightScope.kind &&
      leftScope.organizationId === rightScope.organizationId &&
      (leftScope.kind !== "team" ||
        (rightScope.kind === "team" &&
          leftScope.teamId === rightScope.teamId)) &&
      (leftScope.kind !== "user" ||
        (rightScope.kind === "user" &&
          leftScope.userId === rightScope.userId))
  );
}

export function Workspace({
  accessByOrganization,
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
  const [pendingResourceAction, setPendingResourceAction] =
    useState<PendingResourceAction>();
  const [resourceActionError, setResourceActionError] = useState<string>();
  const [resourceActionMessage, setResourceActionMessage] = useState<string>();
  const [deletingResource, setDeletingResource] = useState(false);
  const [mergeReason, setMergeReason] = useState("");
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
  const organizationAccess = accessByOrganization[organizationId];
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
    setPendingResourceAction(undefined);
    setResourceActionError(undefined);
    setResourceActionMessage(undefined);
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
    setPendingResourceAction(undefined);
    setResourceActionError(undefined);
    setResourceActionMessage(undefined);
  }

  function canManage(scope: unknown): boolean {
    const resource = scopedResource(scope);
    return Boolean(
      organizationAccess &&
        resource &&
        canAccessScopedResource(organizationAccess, "manage", resource)
    );
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
      const body = await responseJson<SearchResponse>(
        response,
        t("workspace.searchFailed")
      );
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
      const body = await responseJson<NeighborhoodResponse>(
        response,
        t("workspace.graphFailed")
      );
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

  async function confirmResourceAction() {
    if (!organizationId || !pendingResourceAction) {
      return;
    }
    setDeletingResource(true);
    setResourceActionError(undefined);
    setResourceActionMessage(undefined);
    const action = pendingResourceAction;
    const path =
      action.kind === "document"
        ? `documents/${action.id}`
        : action.kind === "merge"
          ? `knowledge/nodes/${action.targetNodeId}/merge`
          : `knowledge/${action.kind === "node" ? "nodes" : "edges"}/${action.id}`;
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/${path}`,
        action.kind === "merge"
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceNodeId: action.sourceNodeId,
                reason: mergeReason.trim()
              })
            }
          : { method: "DELETE" }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as {
          error?: string;
        };
        throw new Error(body.error ?? t("resource.deleteFailed"));
      }
      if (action.kind === "merge") {
        setHits((current) =>
          current.filter(
            (hit) => nestedRecord(hit, "node")?.id !== action.sourceNodeId
          )
        );
        setGraphCenterNodeId(undefined);
        setGraphSelectedNodeId(undefined);
        setGraphNodes([]);
        setGraphEdges([]);
        setMergeReason("");
      } else if (action.kind === "document") {
        setHits((current) =>
          current.filter(
            (hit) => nestedRecord(hit, "document")?.id !== action.id
          )
        );
        setGraphCenterNodeId(undefined);
        setGraphSelectedNodeId(undefined);
        setGraphNodes([]);
        setGraphEdges([]);
      } else if (action.kind === "edge") {
        setGraphEdges((current) =>
          current.filter((edge) => edge.id !== action.id)
        );
      } else {
        setHits((current) =>
          current.filter((hit) => nestedRecord(hit, "node")?.id !== action.id)
        );
        setGraphNodes((current) =>
          current.filter((node) => node.id !== action.id)
        );
        setGraphEdges((current) =>
          current.filter(
            (edge) =>
              edge.sourceNodeId !== action.id && edge.targetNodeId !== action.id
          )
        );
        if (graphCenterNodeId === action.id) {
          setGraphCenterNodeId(undefined);
          setGraphSelectedNodeId(undefined);
          setGraphNodes([]);
          setGraphEdges([]);
        } else if (graphSelectedNodeId === action.id) {
          setGraphSelectedNodeId(graphCenterNodeId);
        }
      }
      setPendingResourceAction(undefined);
      setResourceActionMessage(
        action.kind === "document"
          ? t("resource.documentArchived", { name: action.name })
          : action.kind === "merge"
            ? t("resource.nodesMerged", { name: action.name })
          : t("resource.graphDeleted", { name: action.name })
      );
    } catch (caught) {
      setResourceActionError(
        caught instanceof Error ? caught.message : t("resource.deleteFailed")
      );
    } finally {
      setDeletingResource(false);
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
    form.set("scopeKind", documentScopeKind);
    if (documentScopeKind === "team" && documentTeamId) {
      form.set("teamId", documentTeamId);
    }
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/documents`,
        { method: "POST", body: form }
      );
      const body = await responseJson<{
        id?: string;
        error?: string;
        status?: string;
      }>(response, t("workspace.uploadFailed"));
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
          <Avatar color="brand" name={user.name} radius="xl" />
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
              {resourceActionMessage ? (
                <Alert color="green">{resourceActionMessage}</Alert>
              ) : null}
              <SimpleGrid cols={{ base: 1, md: 2 }}>
                {hits.map((hit) => {
                  const node = nestedRecord(hit, "node");
                  const document = nestedRecord(hit, "document");
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
                  const canManageDocument = canManage(document?.scope);
                  const duplicateNode =
                    typeof node?.id === "string" &&
                    typeof node.canonicalName === "string"
                      ? hits
                          .map((candidate) => nestedRecord(candidate, "node"))
                          .find(
                            (candidate) =>
                              typeof candidate?.id === "string" &&
                              candidate.id !== node.id &&
                              typeof candidate.canonicalName === "string" &&
                              knowledgeCanonicalNameKey(
                                candidate.canonicalName
                              ) ===
                                knowledgeCanonicalNameKey(
                                  node.canonicalName as string
                                ) &&
                              sameScope(candidate.scope, node.scope) &&
                              canManage(candidate.scope)
                          )
                      : undefined;
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
                      {typeof node?.kind === "string" ? (
                        <Group gap="xs">
                          <Badge size="xs" variant="dot">{node.kind}</Badge>
                          <Text c="dimmed" size="xs">
                            {t("workspace.nodeSources", {
                              count: Array.isArray(node.sources)
                                ? node.sources.length
                                : 0
                            })}
                          </Text>
                        </Group>
                      ) : null}
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
                      {typeof node?.id === "string" &&
                      typeof duplicateNode?.id === "string" &&
                      canManage(node.scope) ? (
                        <Button
                          color="orange"
                          onClick={() => {
                            setMergeReason("");
                            setPendingResourceAction({
                              kind: "merge",
                              targetNodeId: node.id as string,
                              sourceNodeId: duplicateNode.id as string,
                              name: String(node.canonicalName)
                            });
                          }}
                          size="compact-sm"
                          variant="light"
                        >
                          {t("resource.mergeDuplicate")}
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
                      {typeof document?.id === "string" && canManageDocument ? (
                        <Button
                          color="red"
                          leftSection={<IconArchive size={16} />}
                          onClick={() =>
                            setPendingResourceAction({
                              kind: "document",
                              id: document.id as string,
                              name: String(document.title ?? t("workspace.resultFallback"))
                            })
                          }
                          size="compact-sm"
                          variant="subtle"
                        >
                          {t("resource.archiveDocument")}
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
                      <Text c="brand" fw={750} size="xs" tt="uppercase">
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
                    canDeleteEdge={(edge) => canManage(edge.scope)}
                    canDeleteNode={(node) => canManage(node.scope)}
                    deletingResource={deletingResource}
                    onDeleteEdge={(edge) =>
                      setPendingResourceAction({
                        kind: "edge",
                        id: edge.id,
                        name: edge.predicate
                      })
                    }
                    onDeleteNode={(node) =>
                      setPendingResourceAction({
                        kind: "node",
                        id: node.id,
                        name: node.canonicalName
                      })
                    }
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
                      color={copied ? "teal" : "brand"}
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
      <Modal
        centered
        closeOnClickOutside={!deletingResource}
        closeOnEscape={!deletingResource}
        onClose={() => {
          if (!deletingResource) {
            setPendingResourceAction(undefined);
            setResourceActionError(undefined);
          }
        }}
        opened={pendingResourceAction !== undefined}
        title={
          pendingResourceAction?.kind === "document"
            ? t("resource.archiveDocumentTitle")
            : pendingResourceAction?.kind === "merge"
              ? t("resource.mergeNodesTitle")
            : t("resource.deleteGraphTitle")
        }
      >
        <Stack gap="md">
          <Text size="sm">
            {pendingResourceAction?.kind === "document"
              ? t("resource.archiveDocumentBody", {
                  name: pendingResourceAction.name
                })
              : pendingResourceAction?.kind === "merge"
                ? t("resource.mergeNodesBody", {
                    name: pendingResourceAction.name
                  })
              : t("resource.deleteGraphBody", {
                  name: pendingResourceAction?.name ?? ""
                })}
          </Text>
          {pendingResourceAction?.kind === "merge" ? (
            <Textarea
              autosize
              label={t("resource.mergeReason")}
              maxLength={2_000}
              minRows={2}
              onChange={(event) => setMergeReason(event.currentTarget.value)}
              placeholder={t("resource.mergeReasonPlaceholder")}
              value={mergeReason}
            />
          ) : null}
          {resourceActionError ? (
            <Alert color="red">{resourceActionError}</Alert>
          ) : null}
          <Group justify="flex-end">
            <Button
              disabled={deletingResource}
              onClick={() => {
                setPendingResourceAction(undefined);
                setResourceActionError(undefined);
              }}
              variant="default"
            >
              {t("resource.cancel")}
            </Button>
            <Button
              color="red"
              leftSection={
                pendingResourceAction?.kind === "document" ? (
                  <IconArchive size={16} />
                ) : (
                  <IconTrash size={16} />
                )
              }
              loading={deletingResource}
              disabled={
                pendingResourceAction?.kind === "merge" &&
                mergeReason.trim().length === 0
              }
              onClick={() => void confirmResourceAction()}
            >
              {pendingResourceAction?.kind === "document"
                ? t("resource.confirmArchive")
                : pendingResourceAction?.kind === "merge"
                  ? t("resource.confirmMerge")
                : t("resource.confirmDelete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </main>
  );
}
