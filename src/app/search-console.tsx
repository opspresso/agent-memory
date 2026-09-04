"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title
} from "@mantine/core";
import {
  IconArchive,
  IconSearch,
  IconTrash
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  canAccessScopedResource,
  type ScopedResource
} from "@/domain/identity/organization-access";
import { useT } from "./_i18n/provider";
import {
  neighborhoodResponseSchema,
  scopeResponseSchema,
  searchResponseSchema,
  type SearchHitResponse
} from "./api-response-schemas";
import { responseJson, responseOk } from "./http-response";
import {
  KnowledgeGraph,
  type KnowledgeGraphEdgeView,
  type KnowledgeGraphNodeView
} from "./knowledge-graph";
import { MemoryLifecycle } from "./memory-lifecycle";
import { useOrganization } from "./organization-context";
import { SearchResultCard, searchResultKey } from "./search-result-card";

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

function scopedResource(value: unknown): ScopedResource | undefined {
  const parsed = scopeResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function SearchConsole() {
  const { organizationSlug } = useOrganization();
  if (!organizationSlug) {
    return null;
  }
  return <SearchConsoleView key={organizationSlug} />;
}

function SearchConsoleView() {
  const t = useT();
  const { organizationSlug, access } = useOrganization();
  const [searchKind, setSearchKind] = useState<SearchKind>("context/search");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [hits, setHits] = useState<readonly SearchHitResponse[]>([]);
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
  const [pendingResourceAction, setPendingResourceAction] =
    useState<PendingResourceAction>();
  const [resourceActionError, setResourceActionError] = useState<string>();
  const [resourceActionMessage, setResourceActionMessage] = useState<string>();
  const [deletingResource, setDeletingResource] = useState(false);
  const [mergeReason, setMergeReason] = useState("");
  const graphRequest = useRef<AbortController | undefined>(undefined);
  const searchRequest = useRef<AbortController | undefined>(undefined);

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

  useEffect(
    () => () => {
      graphRequest.current?.abort();
      searchRequest.current?.abort();
    },
    []
  );

  function selectSearchKind(value: string) {
    if (
      value !== "context/search" &&
      value !== "documents" &&
      value !== "knowledge/nodes" &&
      value !== "memories"
    ) {
      return;
    }
    graphRequest.current?.abort();
    graphRequest.current = undefined;
    searchRequest.current?.abort();
    searchRequest.current = undefined;
    setSearching(false);
    setLoadingGraph(false);
    setSearchKind(value);
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
      access && resource && canAccessScopedResource(access, "manage", resource)
    );
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationSlug) {
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
        `/api/organizations/${organizationSlug}/${searchKind}?q=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      );
      const body = await responseJson(
        response,
        t("workspace.searchFailed"),
        searchResponseSchema
      );
      setHits(body.hits);
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
    if (!organizationSlug) {
      return;
    }
    graphRequest.current?.abort();
    const controller = new AbortController();
    graphRequest.current = controller;
    setLoadingGraph(true);
    setGraphError(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationSlug}/knowledge/nodes/${nodeId}/neighborhood?depth=2&limit=100`,
        { signal: controller.signal }
      );
      const body = await responseJson(
        response,
        t("workspace.graphFailed"),
        neighborhoodResponseSchema
      );
      setGraphCenterNodeId(nodeId);
      setGraphSelectedNodeId(nodeId);
      setGraphNodes(body.nodes);
      setGraphEdges(body.edges);
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

  async function confirmResourceAction() {
    if (!organizationSlug || !pendingResourceAction) {
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
        `/api/organizations/${organizationSlug}/${path}`,
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
      await responseOk(response, t("resource.deleteFailed"));
      if (action.kind === "merge") {
        setHits((current) =>
          current.filter(
            (hit) => hit.node?.id !== action.sourceNodeId
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
            (hit) => hit.document?.id !== action.id
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
          current.filter((hit) => hit.node?.id !== action.id)
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

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text c="dimmed" size="sm">
          {t("workspace.eyebrow")}
        </Text>
        <Title order={1}>{t("workspace.title")}</Title>
      </Stack>
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
              disabled={!organizationSlug}
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
            {hits.map((hit) => (
              <SearchResultCard
                canManage={canManage}
                hit={hit}
                hits={hits}
                key={searchResultKey(hit)}
                loadingGraph={loadingGraph}
                onArchiveDocument={(id, name) =>
                  setPendingResourceAction({ kind: "document", id, name })
                }
                onExploreNode={(nodeId) => void exploreKnowledgeNode(nodeId)}
                onMergeNodes={(targetNodeId, sourceNodeId, name) => {
                  setMergeReason("");
                  setPendingResourceAction({
                    kind: "merge",
                    targetNodeId,
                    sourceNodeId,
                    name
                  });
                }}
                onSelectMemory={setSelectedMemoryId}
                peakScore={peakScore}
                showGraphAction={searchKind === "knowledge/nodes"}
              />
            ))}
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
                onSelectNode={setGraphSelectedNodeId}
                selectedNodeId={graphSelectedNodeId ?? graphCenterNodeId}
              />
            </Stack>
          ) : null}
        </Stack>
      </Paper>
      {selectedMemoryId ? (
        <MemoryLifecycle
          memoryId={selectedMemoryId}
          onClose={() => setSelectedMemoryId(undefined)}
          organizationSlug={organizationSlug}
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
    </Stack>
  );
}
