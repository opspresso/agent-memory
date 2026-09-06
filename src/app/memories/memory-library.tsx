"use client";

import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconArrowLeft, IconPlus, IconSearch } from "@tabler/icons-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ScopedResource } from "@/domain/identity/organization-access";
import { useT } from "../_i18n/provider";
import { memoryLibraryResponseSchema, searchResponseSchema } from "../api-response-schemas";
import { responseJson } from "../http-response";
import { MemoryLifecycle } from "../memory-lifecycle";
import { useOrganization } from "../organization-context";
import { MemoryCreate } from "./memory-create";
import classes from "./memory-library.module.css";

interface MemoryRow { readonly id: string; readonly title: string; readonly content: string; readonly scope: ScopedResource; }

export function MemoryLibrary() {
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
  return <MemoryLibraryView key={organizationSlug} selected={acceptsQuery ? params.get("memory") ?? undefined : undefined} creating={acceptsQuery && params.get("create") === "true"} />;
}

function MemoryLibraryView({ selected, creating }: { readonly selected?: string; readonly creating: boolean }) {
  const t = useT();
  const router = useRouter();
  const { organizationSlug, access } = useOrganization();
  const [rows, setRows] = useState<readonly MemoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const queryInput = useRef<HTMLInputElement>(null);
  const detailPanel = useRef<HTMLElement | null>(null);
  const selectedRow = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (creating) return;
    if (selected) detailPanel.current?.focus();
    else if (selectedRow.current) {
      (selectedRow.current.isConnected ? selectedRow.current : queryInput.current)?.focus();
    }
  }, [selected, creating]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(activeQuery
          ? `/api/organizations/${organizationSlug}/memories?q=${encodeURIComponent(activeQuery)}&limit=100`
          : `/api/organizations/${organizationSlug}/memories/library?limit=25&offset=${offset}`, { signal: controller.signal });
        if (activeQuery) {
          const body = await responseJson(response, t("memoryUi.loadFailed"), searchResponseSchema);
          if (!controller.signal.aborted) { setRows(body.hits.flatMap((hit) => hit.memory ? [hit.memory] : [])); setNextOffset(null); }
        } else {
          const body = await responseJson(response, t("memoryUi.loadFailed"), memoryLibraryResponseSchema);
          if (!controller.signal.aborted) { setRows(body.memories); setNextOffset(body.nextOffset); }
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setRows([]);
          setNextOffset(null);
          setError(caught instanceof Error ? caught.message : t("memoryUi.loadFailed"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [activeQuery, offset, organizationSlug, reload, t]);

  function select(id: string | undefined, replace = false) {
    const href = id ? `/memories?memory=${encodeURIComponent(id)}` : "/memories";
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }
  function openCreate() {
    const query = new URLSearchParams({ create: "true" });
    if (selected) query.set("memory", selected);
    router.push(`/memories?${query}`, { scroll: false });
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    setOffset(0);
    setActiveQuery(query.trim());
    setReload((current) => current + 1);
  }
  function refresh() { setLoading(true); setError(undefined); setOffset(0); setReload((current) => current + 1); }
  function page(offset: number) { setLoading(true); setError(undefined); setOffset(offset); }

  return <Stack gap="lg">
    <Group justify="space-between" align="flex-start">
      <Stack gap={4}><Title order={1}>{t("nav.memory")}</Title><Text c="dimmed" size="sm">{t("memoryUi.description")}</Text></Stack>
      <Button leftSection={<IconPlus size={16} />} onClick={openCreate} disabled={!access}>{t("memoryUi.create")}</Button>
    </Group>
    <div className={classes.workspace} data-selected={Boolean(selected)}>
      <Paper className={classes.list} withBorder radius="md" p="md">
        <Stack gap="md">
          <form onSubmit={search}><Group gap="xs" wrap="nowrap"><TextInput ref={queryInput} className={classes.search} aria-label={t("memoryUi.search")} placeholder={t("memoryUi.search")} leftSection={<IconSearch size={16} />} value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Button type="submit" variant="light" loading={loading} aria-label={t("memoryUi.search")}><IconSearch size={17} /></Button></Group></form>
          <Group justify="space-between"><Text size="xs" c="dimmed">{t(activeQuery ? "memoryUi.results" : "memoryUi.recent", { count: rows.length })}</Text><Button variant="subtle" size="compact-xs" onClick={refresh}>{t("memory.reload")}</Button></Group>
          {error ? <Alert color="red" role="alert">{error}</Alert> : null}
          {loading ? <Group justify="center" p="xl"><Loader size="sm" /><Text size="sm" c="dimmed">{t("memoryUi.loading")}</Text></Group> : rows.length ? <div className={classes.rows}>{rows.map((memory) => <button key={memory.id} type="button" className={classes.row} data-selected={selected === memory.id} aria-pressed={selected === memory.id} onClick={(event) => { selectedRow.current = event.currentTarget; select(memory.id); }}><Group justify="space-between" gap="xs" wrap="nowrap"><Text component="span" fw={650} size="sm" className={classes.rowTitle}>{memory.title}</Text><Badge component="span" size="xs" variant="light" color="gray">{t(`workspace.scope.${memory.scope.kind}`)}</Badge></Group><Text component="span" c="dimmed" size="xs" lineClamp={2}>{memory.content}</Text></button>)}</div> : !error ? <Stack align="center" gap="sm" py="xl"><Text fw={600}>{t(activeQuery ? "memoryUi.noResults" : "memoryUi.empty")}</Text><Text size="sm" c="dimmed" ta="center">{t(activeQuery ? "memoryUi.noResultsHint" : "memoryUi.emptyHint")}</Text>{!activeQuery ? <Button variant="light" onClick={openCreate} disabled={!access}>{t("memoryUi.create")}</Button> : null}</Stack> : null}
          {!activeQuery && (offset > 0 || nextOffset !== null) ? <Group justify="space-between"><Button size="xs" variant="default" disabled={loading || offset === 0} onClick={() => page(Math.max(0, offset - 25))}>{t("memoryUi.previous")}</Button><Button size="xs" variant="default" disabled={loading || nextOffset === null} onClick={() => nextOffset !== null && page(nextOffset)}>{t("memoryUi.next")}</Button></Group> : null}
        </Stack>
      </Paper>
      <section className={classes.detail} aria-label={t("memoryUi.read")} ref={detailPanel} tabIndex={-1}>
        {selected ? <><Button className={classes.back} leftSection={<IconArrowLeft size={15} />} variant="subtle" mb="sm" onClick={() => select(undefined)}>{t("memoryUi.back")}</Button><MemoryLifecycle key={`${organizationSlug}:${selected}`} embedded memoryId={selected} organizationSlug={organizationSlug} onClose={() => select(undefined)} onChanged={refresh} /></> : <Paper className={classes.placeholder} withBorder radius="md" p="xl"><Stack align="center" gap="xs"><Title order={3}>{t("memoryUi.select")}</Title><Text size="sm" c="dimmed" ta="center">{t("memoryUi.selectHint")}</Text></Stack></Paper>}
      </section>
    </div>
    {creating ? <MemoryCreate onClose={() => select(selected, true)} onCreated={(id) => { setQuery(""); setActiveQuery(""); refresh(); select(id, true); }} /> : null}
  </Stack>;
}
