"use client";

import { Alert, Anchor, Badge, Button, Drawer, Group, Modal, Paper, Skeleton, Stack, Text, Title } from "@mantine/core";
import { IconArchive, IconCloudUpload, IconFileText, IconRefresh } from "@tabler/icons-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";

import { canAccessScopedResource } from "@/domain/identity/organization-access";

import { useLocale, useT } from "../_i18n/provider";
import { documentContentsResponseSchema, documentDetailResponseSchema, documentLibraryResponseSchema } from "../api-response-schemas";
import { responseJson, responseOk } from "../http-response";
import { useOrganization } from "../organization-context";
import { EmptyState, WorkspaceHeader, WorkspaceSection } from "../workspace-components";

import { DocumentUpload } from "./document-upload";
import classes from "./document-library.module.css";

type DocumentView = z.infer<typeof documentDetailResponseSchema>;
const statusColor = { pending: "gray", processing: "blue", ready: "teal", failed: "red", archived: "gray" } as const;

function safeSourceUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch { return undefined; }
}

function DocumentContents({ documentId }: { readonly documentId: string }) {
  const t = useT();
  const { organizationSlug } = useOrganization();
  const [chunks, setChunks] = useState<z.infer<typeof documentContentsResponseSchema>["chunks"]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [request, setRequest] = useState({ offset: 0, version: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/organizations/${organizationSlug}/documents/${documentId}/chunks?limit=25&offset=${request.offset}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 403 || response.status === 404) {
          setChunks([]);
          setNextOffset(null);
        }
        const body = await responseJson(response, t("documentUi.contents.failed"), documentContentsResponseSchema);
        if (controller.signal.aborted) return;
        if (body.document.id !== documentId || body.document.status !== "ready") {
          setChunks([]);
          setNextOffset(null);
          throw new Error(t("documentUi.contents.failed"));
        }
        setChunks((current) => request.offset === 0 ? body.chunks : [...current, ...body.chunks.filter((chunk) => !current.some((item) => item.id === chunk.id))]);
        setNextOffset(body.nextOffset);
      } catch {
        if (!controller.signal.aborted) setError(t("documentUi.contents.failed"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [documentId, organizationSlug, request, t]);

  function loadPage(offset: number) {
    setError(undefined);
    setLoading(true);
    setRequest((current) => ({ offset, version: current.version + 1 }));
  }

  return <section aria-label={t("documentUi.contents.title")}>
    <Stack gap="md">
      <Stack gap={4}><Title order={3}>{t("documentUi.contents.title")}</Title><Text c="dimmed" size="sm">{t("documentUi.contents.description")}</Text></Stack>
      {error ? <Alert color="red" role="alert"><Stack gap="xs"><Text size="sm">{error}</Text><Button variant="light" size="xs" onClick={() => loadPage(0)}>{t("documentUi.refresh")}</Button></Stack></Alert> : null}
      {loading && chunks.length === 0 ? <Skeleton height={150} aria-label={t("documentUi.contents.loading")} /> : null}
      {!loading && !error && chunks.length === 0 ? <Text c="dimmed" size="sm">{t("documentUi.contents.empty")}</Text> : null}
      {chunks.length > 0 ? <>
        <Text c="dimmed" size="xs" role="status">{t("documentUi.contents.count", { count: chunks.length })}</Text>
        <div className={classes.contents} role="region" tabIndex={0} aria-label={t("documentUi.contents.body")}>
          {chunks.map((chunk) => <article key={chunk.id} className={classes.chunk}><Text size="xs" c="dimmed" fw={600}>{t("documentUi.contents.part", { number: chunk.ordinal + 1 })}</Text><Text size="sm" className={classes.chunkBody}>{chunk.content}</Text></article>)}
        </div>
      </> : null}
      {!error && nextOffset !== null ? <Button variant="default" loading={loading} onClick={() => loadPage(nextOffset)}>{t("documentUi.contents.more")}</Button> : null}
    </Stack>
  </section>;
}

export function DocumentLibrary() {
  const { organizationSlug } = useOrganization();
  const params = useSearchParams();
  const queryString = params.toString();
  const [navigation, setNavigation] = useState<{ organizationSlug: string; blockedQuery: string | null }>({ organizationSlug, blockedQuery: null });
  if (navigation.organizationSlug !== organizationSlug) {
    setNavigation({ organizationSlug, blockedQuery: queryString });
  } else if (navigation.blockedQuery !== null && navigation.blockedQuery !== queryString) {
    setNavigation({ organizationSlug, blockedQuery: null });
  }
  const acceptsQuery = navigation.organizationSlug === organizationSlug && navigation.blockedQuery !== queryString;
  if (!organizationSlug) return null;
  return <DocumentLibraryView key={organizationSlug} selectedId={acceptsQuery ? params.get("document") ?? undefined : undefined} />;
}

function DocumentLibraryView({ selectedId }: { readonly selectedId?: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const { organizationSlug, access } = useOrganization();
  const [documents, setDocuments] = useState<readonly DocumentView[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [page, setPage] = useState({ offset: 0, version: 0 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string>();
  const [selection, setSelection] = useState({ id: selectedId, version: 0, retryAttempt: undefined as number | undefined });
  const [detail, setDetail] = useState<{ id: string; value?: DocumentView; error?: string }>();
  const [pollPaused, setPollPaused] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; documentId?: string }>();
  const [mutationError, setMutationError] = useState<string>();
  const detailPanel = useRef<HTMLDivElement | null>(null);
  const rowElements = useRef(new Map<string, HTMLButtonElement>());
  const lastSelectedId = useRef<string | undefined>(undefined);
  const mutationController = useRef<AbortController | null>(null);
  const selected = detail && detail.id === selection.id ? detail.value : undefined;
  const detailError = detail && detail.id === selection.id ? detail.error : undefined;
  const canWrite = Boolean(selected && access && canAccessScopedResource(access, "write", selected.scope));
  const canManage = Boolean(selected && access && canAccessScopedResource(access, "manage", selected.scope));
  const sourceUrl = safeSourceUrl(selected?.sourceUri);

  if (selection.id !== selectedId) {
    setSelection({ id: selectedId, version: 0, retryAttempt: undefined });
    setPollPaused(false);
    setArchiveOpen(false);
    setMutating(false);
    setMutationError(undefined);
  }

  useEffect(() => () => mutationController.current?.abort(), [selectedId]);

  useEffect(() => {
    if (selectedId) {
      lastSelectedId.current = selectedId;
      if (window.matchMedia("(max-width: 56em)").matches) {
        detailPanel.current?.focus({ preventScroll: true });
        detailPanel.current?.scrollIntoView({ behavior: "instant", block: "start" });
      }
    } else if (lastSelectedId.current) {
      rowElements.current.get(lastSelectedId.current)?.focus();
    }
  }, [selectedId]);

  function selectDocumentUrl(id?: string, replace = false) {
    const href = id ? `/documents?document=${encodeURIComponent(id)}` : "/documents";
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/organizations/${organizationSlug}/documents/library?limit=25&offset=${page.offset}`, { signal: controller.signal })
      .then((response) => responseJson(response, t("documentUi.loadFailed"), documentLibraryResponseSchema))
      .then((body) => {
        if (controller.signal.aborted) return;
        setDocuments((current) => page.offset === 0 ? body.documents : [...current, ...body.documents.filter((row) => !current.some((item) => item.id === row.id))]);
        setNextOffset(body.nextOffset);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : t("documentUi.loadFailed")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationSlug, page, t]);

  useEffect(() => {
    const id = selection.id;
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let requests = 0;
    let observedProcessing = false;
    async function load() {
      if (controller.signal.aborted) return;
      if (Date.now() - started >= 120_000 || requests >= 24) { setPollPaused(true); return; }
      if (document.visibilityState === "hidden") { timer = setTimeout(() => void load(), 5_000); return; }
      try {
        requests += 1;
        const response = await fetch(`/api/organizations/${organizationSlug}/documents/${id}`, { signal: controller.signal });
        const value = await responseJson(response, t("documentUi.loadFailed"), documentDetailResponseSchema);
        if (controller.signal.aborted) return;
        setDetail({ id: id!, value });
        setDocuments((current) => current.map((row) => row.id === id ? value : row));
        const processing = value.status === "pending" || value.status === "processing";
        observedProcessing ||= processing;
        const waitingForRetry = selection.retryAttempt !== undefined && value.status === "failed" && !observedProcessing && value.processingAttempts === selection.retryAttempt;
        if (processing || waitingForRetry) timer = setTimeout(() => void load(), 5_000);
      } catch (error) {
        if (!controller.signal.aborted) setDetail({ id: id!, error: error instanceof Error ? error.message : t("documentUi.loadFailed") });
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [organizationSlug, selection, t]);

  function refreshList() {
    setLoading(true);
    setListError(undefined);
    setPage((current) => ({ offset: 0, version: current.version + 1 }));
  }

  function choose(id: string) {
    setPollPaused(false);
    setMutationError(undefined);
    setFeedback(undefined);
    selectDocumentUrl(id);
  }

  function refreshDetail() {
    setPollPaused(false);
    setSelection((current) => ({ ...current, version: current.version + 1 }));
  }

  async function mutate(action: "retry" | "archive") {
    if (!selected) return;
    const controller = new AbortController();
    mutationController.current = controller;
    setMutating(true);
    setMutationError(undefined);
    setFeedback(undefined);
    try {
      const response = await fetch(`/api/organizations/${organizationSlug}/documents/${selected.id}${action === "retry" ? "/retry" : ""}`, { method: action === "retry" ? "POST" : "DELETE", signal: controller.signal });
      await responseOk(response, t("documentUi.actionFailed"));
      if (controller.signal.aborted) return;
      if (action === "archive") {
        setArchiveOpen(false);
        selectDocumentUrl(undefined, true);
        setFeedback({ message: t("documentUi.archived") });
        refreshList();
      } else {
        setFeedback({ message: t("documentUi.retryQueued"), documentId: selected.id });
        setPollPaused(false);
        setSelection((current) => ({ ...current, version: current.version + 1, retryAttempt: selected.processingAttempts }));
      }
    } catch (error) {
      if (!controller.signal.aborted) setMutationError(error instanceof Error ? error.message : t("documentUi.actionFailed"));
    } finally { if (!controller.signal.aborted) setMutating(false); }
  }

  return <Stack gap="lg">
    <WorkspaceHeader eyebrow={t("documentUi.eyebrow")} title={t("documentUi.title")} description={t("documentUi.description")} actions={<Group gap="xs"><Button variant="default" leftSection={<IconRefresh size={16} />} loading={loading} onClick={refreshList}>{t("documentUi.refresh")}</Button><Button leftSection={<IconCloudUpload size={16} />} disabled={mutating} onClick={() => setUploadOpen(true)}>{t("workspace.uploadTitle")}</Button></Group>} />
    {feedback && (!feedback.documentId || feedback.documentId === selectedId) ? <Alert color="teal" role="status">{feedback.message}</Alert> : null}
    {mutationError ? <Alert color="red" role="alert">{mutationError}</Alert> : null}
    <div className={classes.layout}>
      <WorkspaceSection title={t("documentUi.library")} description={t("documentUi.count", { count: documents.length })}>
        {listError ? <Alert color="red" role="alert">{listError}<Button mt="sm" variant="light" onClick={refreshList}>{t("documentUi.refresh")}</Button></Alert> : null}
        {loading && documents.length === 0 ? <Stack aria-label={t("documentUi.loading")} aria-busy="true"><Skeleton height={70} /><Skeleton height={70} /><Skeleton height={70} /></Stack> : null}
        {!loading && !listError && documents.length === 0 ? <EmptyState icon={<IconFileText size={24} />} title={t("documentUi.emptyTitle")} description={t("documentUi.emptyBody")} action={<Button onClick={() => setUploadOpen(true)}>{t("workspace.uploadTitle")}</Button>} /> : null}
        <div className={classes.list}>
          {documents.map((row) => <button type="button" ref={(element) => { if (element) rowElements.current.set(row.id, element); else rowElements.current.delete(row.id); }} className={classes.row} aria-pressed={selection.id === row.id} disabled={mutating} key={row.id} onClick={() => choose(row.id)}><Group justify="space-between" gap="xs"><Text component="span" fw={600} className={classes.rowTitle}>{row.title}</Text><Badge color={statusColor[row.status]} variant="light">{t(`documentUi.status.${row.status}`)}</Badge></Group><Text component="span" size="xs" c="dimmed">{t(`workspace.scope.${row.scope.kind}`)} · {new Date(row.createdAt).toLocaleDateString(locale)}</Text></button>)}
        </div>
        {nextOffset !== null ? <Button variant="default" loading={loading} onClick={() => { setLoading(true); setListError(undefined); setPage((current) => ({ offset: nextOffset, version: current.version + 1 })); }}>{t("documentUi.more")}</Button> : null}
      </WorkspaceSection>
      <Paper ref={detailPanel} role="region" tabIndex={-1} aria-label={selected?.title ?? t("documentUi.selectTitle")} p={{ base: "md", sm: "lg" }} withBorder className={classes.detail}>
        {selection.id ? <Button className={classes.back} mb="sm" size="xs" variant="subtle" disabled={mutating} onClick={() => selectDocumentUrl()}>{t("memoryUi.back")}</Button> : null}
        {!selection.id ? <EmptyState icon={<IconFileText size={24} />} title={t("documentUi.selectTitle")} description={t("documentUi.selectBody")} /> : detailError ? <Alert color="red" role="alert">{detailError}<Button mt="sm" variant="light" onClick={refreshDetail}>{t("documentUi.refresh")}</Button></Alert> : !selected ? <Skeleton height={260} aria-label={t("documentUi.loading")} /> : <Stack gap="lg">
          <Group justify="space-between" align="flex-start"><Stack gap={6}><Badge color={statusColor[selected.status]}>{t(`documentUi.status.${selected.status}`)}</Badge><Title order={2} className={classes.title}>{selected.title}</Title></Stack><Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={refreshDetail}>{t("documentUi.refresh")}</Button></Group>
          <Text c="dimmed" size="sm">{t(`documentUi.help.${selected.status}`)}</Text>
          <Badge variant="light">{t(`workspace.scope.${selected.scope.kind}`)}</Badge>
          <dl className={classes.metadata}><dt>{t("documentUi.format")}</dt><dd>{selected.mimeType}</dd><dt>{t("documentUi.size")}</dt><dd>{new Intl.NumberFormat(locale).format(selected.sizeBytes)} bytes</dd><dt>{t("documentUi.created")}</dt><dd>{new Date(selected.createdAt).toLocaleString(locale)}</dd><dt>{t("documentUi.updated")}</dt><dd>{new Date(selected.updatedAt).toLocaleString(locale)}</dd><dt>{t("documentUi.attempts")}</dt><dd>{selected.processingAttempts}</dd></dl>
          {selected.processingError ? <Alert color="red" title={t("documentUi.processingError")}><Text size="sm" className={classes.error}>{selected.processingError}</Text></Alert> : null}
          {pollPaused ? <Alert color="gray">{t("documentUi.pollPaused")}</Alert> : null}
          {selected.sourceUri ? <Stack gap={4}><Text fw={600} size="sm">{t("documentUi.source")}</Text>{sourceUrl ? <Anchor href={sourceUrl} target="_blank" rel="noopener noreferrer" className={classes.title}>{selected.sourceUri}</Anchor> : <Text size="sm" className={classes.title}>{selected.sourceUri}</Text>}</Stack> : null}
          {selected.status === "ready" ? <DocumentContents key={`${selected.id}:${selected.updatedAt}`} documentId={selected.id} /> : null}
          {selected.status === "ready" ? <Button component={Link} href="/?kind=documents" variant="light">{t("documentUi.findContent")}</Button> : null}
          <Group justify="space-between">{selected.status === "failed" && canWrite ? <Button leftSection={<IconRefresh size={16} />} loading={mutating} onClick={() => void mutate("retry")}>{t("documentUi.retry")}</Button> : <span />}{canManage ? <Button color="red" variant="subtle" leftSection={<IconArchive size={16} />} disabled={mutating} onClick={() => setArchiveOpen(true)}>{t("documentUi.archive")}</Button> : null}</Group>
        </Stack>}
      </Paper>
    </div>
    <Drawer position="right" size="lg" opened={uploadOpen} onClose={() => { if (!uploading) setUploadOpen(false); }} closeOnClickOutside={!uploading} closeOnEscape={!uploading} withCloseButton={!uploading} title={t("workspace.uploadTitle")} attributes={{ content: { "aria-label": t("workspace.uploadTitle") } }}>
      <DocumentUpload onUploadingChange={setUploading} onUploaded={(id) => { setUploadOpen(false); setUploading(false); refreshList(); choose(id); setFeedback({ message: t("documentUi.uploaded"), documentId: id }); }} />
    </Drawer>
    <Modal opened={archiveOpen} onClose={() => { if (!mutating) setArchiveOpen(false); }} closeOnClickOutside={!mutating} closeOnEscape={!mutating} title={t("documentUi.archive")} attributes={{ content: { "aria-label": t("documentUi.archive") } }} centered><Stack><Text>{t("documentUi.archiveConfirm")}</Text><Group justify="flex-end"><Button variant="default" disabled={mutating} onClick={() => setArchiveOpen(false)}>{t("documentUi.cancel")}</Button><Button color="red" loading={mutating} onClick={() => void mutate("archive")}>{t("documentUi.archive")}</Button></Group></Stack></Modal>
  </Stack>;
}
