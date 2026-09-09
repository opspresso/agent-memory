"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea
} from "@mantine/core";
import {
  IconArchive,
  IconSearch,
  IconTrash
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
import { SearchResultCard, SearchHitDetails, searchResultKey } from "./search-result-card";
import { WorkspaceHeader, EmptyState } from "./workspace-components";
import { KnowledgeProcessingStatus } from "./knowledge/knowledge-processing-status";
import classes from "./search-workspace.module.css";

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

export function SearchConsole({ initialKind = "context/search" }: { readonly initialKind?: SearchKind }) {
  const { organizationSlug } = useOrganization();
  const parameters = useSearchParams();
  const value = parameters.get("kind");
  const kind = value === "documents" || value === "memories" || value === "knowledge/nodes" || value === "context/search" ? value : initialKind;
  const query = parameters.get("q")?.trim() ?? "";
  if (!organizationSlug) return null;
  return <SearchConsoleView key={`${organizationSlug}:${kind}:${query}`} initialKind={kind} initialQuery={query} />;
}

function SearchConsoleView({ initialKind, initialQuery }: { readonly initialKind: SearchKind; readonly initialQuery: string }) {
  const t = useT();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const pathname = usePathname();
  const { organizationSlug, access } = useOrganization();
  const searchKind = initialKind;
  const [searching, setSearching] = useState(Boolean(initialQuery));
  const [searchError, setSearchError] = useState<string>();
  const [hits, setHits] = useState<readonly SearchHitResponse[]>([]);
  const [selectedResultKey, setSelectedResultKey] = useState<string>();
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
  const lastSearchQuery = useRef(initialQuery);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const selectedHit = hits.find((hit) => searchResultKey(hit) === selectedResultKey);
  const detailPanel = useRef<HTMLElement | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (selectedResultKey && !graphCenterNodeId) detailPanel.current?.focus();
  }, [selectedResultKey, graphCenterNodeId]);

  function closeDetail() {
    setSelectedResultKey(undefined);
    setSelectedMemoryId(undefined);
    requestAnimationFrame(() => {
      const button = selectedButton.current;
      (button?.isConnected ? button : searchInput.current)?.focus();
    });
  }

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

  useEffect(() => {
    if (!initialQuery) return;
    const controller = new AbortController();
    searchRequest.current = controller;
    fetch(`/api/${searchKind}?q=${encodeURIComponent(initialQuery)}`, { signal: controller.signal })
      .then((response) => responseJson(response, t("workspace.searchFailed"), searchResponseSchema))
      .then((body) => { if (!controller.signal.aborted) setHits(body.hits); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : t("workspace.searchFailed"));
      })
      .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    return () => controller.abort();
  }, [initialQuery, organizationSlug, searchKind, t]);

  function selectSearchKind(value: string) {
    const parameters = new URLSearchParams({ kind: value });
    const query = searchInput.current?.value.trim() ?? lastSearchQuery.current;
    if (query) parameters.set("q", query);
    startNavigation(() => router.push(`${pathname}?${parameters}`, { scroll: false }));
  }

  function canManage(scope: unknown): boolean {
    const resource = scopedResource(scope);
    return Boolean(
      access && resource && canAccessScopedResource(access, "manage", resource)
    );
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get("query") ?? "").trim();
    if (!query) return;
    if (query === initialQuery) {
      await searchForQuery(query);
    } else {
      startNavigation(() => router.push(`${pathname}?${new URLSearchParams({ q: query, kind: searchKind })}`, { scroll: false }));
    }
  }

  async function searchForQuery(query: string) {
    if (!organizationSlug) {
      return;
    }
    if (!query) {
      return;
    }
    lastSearchQuery.current = query;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setSearchError(undefined);
    try {
      const response = await fetch(
        `/api/${searchKind}?q=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      );
      const body = await responseJson(
        response,
        t("workspace.searchFailed"),
        searchResponseSchema
      );
      if (!controller.signal.aborted) {
        setHits(body.hits);
      }
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

  function refreshAfterMemoryChange() {
    graphRequest.current?.abort();
    setGraphCenterNodeId(undefined);
    setGraphSelectedNodeId(undefined);
    setGraphNodes([]);
    setGraphEdges([]);
    setGraphError(undefined);
    setLoadingGraph(false);
    void searchForQuery(lastSearchQuery.current);
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
        `/api/knowledge/nodes/${nodeId}/neighborhood?depth=2&limit=100`,
        { signal: controller.signal }
      );
      const body = await responseJson(
        response,
        t("workspace.graphFailed"),
        neighborhoodResponseSchema
      );
      if (controller.signal.aborted) return;
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
    graphRequest.current?.abort();
    searchRequest.current?.abort();
    setLoadingGraph(false);
    setSearching(false);
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
        `/api/${path}`,
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
      <WorkspaceHeader
        title={pathname === "/knowledge" ? t("nav.graph") : t("workspace.tab.search")}
        description={t("searchUi.description")}
        actions={<><Button component={Link} href="/memories?create=true" variant="default">{t("memoryUi.create")}</Button><Button component={Link} href="/documents">{t("searchUi.ingest")}</Button></>}
      />
      {searchKind === "knowledge/nodes" ? <KnowledgeProcessingStatus query={initialQuery} /> : null}
      <Paper p="md" withBorder>
        <Stack gap="md">
          {pathname !== "/knowledge" ? <div className={classes.filters}><SegmentedControl
            data={[
              { label: t("searchUi.all"), value: "context/search" },
              { label: "Memory", value: "memories" },
              { label: "Documents", value: "documents" },
              { label: "Graph", value: "knowledge/nodes" }
            ]}
            onChange={selectSearchKind}
            disabled={navigating}
            value={searchKind}
          /></div> : null}
          <form onSubmit={search}>
            <TextInput
              ref={searchInput}
              aria-label={t("workspace.search")}
              defaultValue={initialQuery}
              disabled={!organizationSlug || navigating}
              leftSection={<IconSearch size={17} />}
              name="query"
              placeholder={t("workspace.searchPlaceholder")}
              rightSection={<Button loading={searching || navigating} size="compact-sm" type="submit">{t("workspace.search")}</Button>}
              rightSectionWidth={76}
              size="md"
            />
          </form>
        </Stack>
      </Paper>
      {searchError ? <Alert color="red">{searchError}</Alert> : null}
      {resourceActionMessage ? <Alert color="green" role="status">{resourceActionMessage}</Alert> : null}
      {graphError ? <Alert color="red">{graphError}</Alert> : null}
      {graphCenterNodeId && graphNodes.length > 0 ? (
        <Stack gap="md">
          <Group justify="space-between">
            <Button variant="default" onClick={() => { graphRequest.current?.abort(); setLoadingGraph(false); setGraphCenterNodeId(undefined); setGraphNodes([]); setGraphEdges([]); }}>{t("searchUi.backResults")}</Button>
            <Group gap="xs">
              <Button size="xs" variant="light" loading={loadingGraph} disabled={deletingResource} onClick={() => void exploreKnowledgeNode(graphCenterNodeId)}>{t("knowledgeProgress.refresh")}</Button>
              <Badge>{t("workspace.mapCount", { nodes: graphNodes.length, edges: graphEdges.length })}</Badge>
            </Group>
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
      ) : searching && hits.length === 0 && !selectedMemoryId ? <Stack aria-label={t("searchUi.loading")}><Skeleton height={120} /><Skeleton height={120} /></Stack> : hits.length > 0 || selectedMemoryId ? (
        <>
          <Text size="sm" c="dimmed" role="status">{t("searchUi.results", { count: hits.length })}</Text>
          <div className={classes.workspace} data-detail={Boolean(selectedHit || selectedMemoryId) || undefined}>
            <div className={classes.list} aria-label={t("searchUi.resultsLabel")}>
              {hits.map((hit) => <SearchResultCard key={searchResultKey(hit)} hit={hit} selected={selectedResultKey === searchResultKey(hit)} onSelect={(button) => { selectedButton.current = button; setSelectedResultKey(searchResultKey(hit)); setSelectedMemoryId(hit.memory?.id); }} />)}
              {hits.length === 0 ? <Text p="md" size="sm" c="dimmed">{t("searchUi.noResults")}</Text> : null}
            </div>
            <section className={classes.detail} aria-label={t("searchUi.detail")} ref={detailPanel} tabIndex={-1}>
              {selectedHit || selectedMemoryId ? <Stack gap="md">
                <Group justify="space-between"><Text size="xs" c="dimmed">{t("searchUi.detail")}</Text><Button variant="subtle" size="xs" onClick={closeDetail}>{t("searchUi.closeDetail")}</Button></Group>
                {selectedMemoryId ? <MemoryLifecycle embedded key={selectedMemoryId} memoryId={selectedMemoryId} organizationSlug={organizationSlug} onClose={closeDetail} onChanged={refreshAfterMemoryChange} /> : selectedHit ? (
                  <SearchHitDetails hit={selectedHit} hits={hits} canManage={canManage} loadingGraph={loadingGraph} peakScore={peakScore} onExploreNode={(id) => void exploreKnowledgeNode(id)} onMergeNodes={(targetNodeId, sourceNodeId, name) => { setMergeReason(""); setPendingResourceAction({ kind: "merge", targetNodeId, sourceNodeId, name }); }} />
                ) : null}
              </Stack> : <EmptyState title={t("searchUi.selectTitle")} description={t("searchUi.selectBody")} />}
            </section>
          </div>
        </>
      ) : !searchError ? <Paper withBorder><EmptyState
        icon={<IconSearch size={24} />}
        title={initialQuery ? t("searchUi.noResults") : t("searchUi.startTitle")}
        description={initialQuery ? t("searchUi.noResultsBody") : t("searchUi.startBody")}
        action={<Button component={Link} href="/memories" variant="default">{t("nav.memory")}</Button>}
      /></Paper> : null}
      <Modal
        attributes={{ content: { "aria-label": pendingResourceAction?.kind === "document" ? t("resource.archiveDocumentTitle") : pendingResourceAction?.kind === "merge" ? t("resource.mergeNodesTitle") : t("resource.deleteGraphTitle") } }}
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
