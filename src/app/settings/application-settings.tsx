"use client";

import { Alert, Badge, Button, Group, NumberInput, PasswordInput, Select, Skeleton, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { IconCheck, IconDeviceFloppy, IconSearch } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { appSettingDefinitions, type AppSettingName } from "@/domain/settings/app-settings";
import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";
import { booleanSettings, choiceSettings, editSettingDraft, numericSettings, settingGroups, type ApplicationSection } from "./settings-catalog";
import classes from "./settings.module.css";

const settingsViewSchema = z.object({
  fields: z.record(z.enum(appSettingDefinitions.map((definition) => definition.name)), z.object({
    value: z.string(), source: z.enum(["override", "env", "default", "unset"]), secret: z.boolean(), restartRequired: z.boolean()
  })), updatedAt: z.string().optional()
});
type SettingsView = z.infer<typeof settingsViewSchema>;

export function ApplicationSettings({ isAdmin, section, onDirtyChange }: {
  readonly isAdmin: boolean; readonly section: ApplicationSection; readonly onDirtyChange: (count: number) => void;
}) {
  const t = useT();
  const [view, setView] = useState<SettingsView>();
  const [draft, setDraft] = useState<Partial<Record<AppSettingName, string>>>({});
  const [reset, setReset] = useState<ReadonlySet<AppSettingName>>(new Set());
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState<string>();
  const [restartNotice, setRestartNotice] = useState(false);
  const [error, setError] = useState<string>();
  const loaded = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const restoreBackups = useRef<Partial<Record<AppSettingName, string>>>({});
  useEffect(() => { if (error || message) { feedback.current?.focus(); } }, [error, message]);
  const applyView = useCallback((next: SettingsView) => {
    loaded.current = true; setView(next); setDraft({}); setReset(new Set()); restoreBackups.current = {};
  }, []);
  const changedNames = [...new Set([...Object.keys(draft) as AppSettingName[], ...reset])];
  const restartCount = changedNames.filter((name) => view?.fields[name].restartRequired).length;
  useEffect(() => { onDirtyChange(changedNames.length); }, [changedNames.length, onDirtyChange]);
  useEffect(() => {
    if (!isAdmin || loaded.current) { return; }
    const controller = new AbortController();
    void fetch("/api/settings/runtime", { signal: controller.signal })
      .then((response) => responseJson(response, t("settings.application.loadFailed"), settingsViewSchema))
      .then((body) => { if (!controller.signal.aborted) { applyView(body); setError(undefined); } })
      .catch((caught: unknown) => { if (!controller.signal.aborted) { setError(caught instanceof Error ? caught.message : t("settings.application.loadFailed")); } });
    return () => controller.abort();
  }, [applyView, attempt, isAdmin, t]);

  async function save() {
    setPending(true); setError(undefined); setMessage(undefined);
    try {
      const response = await fetch("/api/settings/runtime", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: [...reset], values: draft }) });
      const body = await responseJson(response, t("settings.application.saveFailed"), settingsViewSchema);
      applyView(body); setMessage(t("settings.application.saved")); setRestartNotice((current) => current || restartCount > 0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t("settings.application.saveFailed")); }
    finally { setPending(false); }
  }
  function discard() { restoreBackups.current = {}; setDraft({}); setReset(new Set()); setError(undefined); setMessage(undefined); }
  function edit(name: AppSettingName, value: string) {
    const field = view!.fields[name];
    setDraft((current) => editSettingDraft(current, name, value, field.value, field.secret));
    setMessage(undefined);
  }
  function restore(name: AppSettingName) {
    if (reset.has(name)) {
      const previous = restoreBackups.current[name];
      setDraft((current) => previous === undefined ? current : { ...current, [name]: previous });
      delete restoreBackups.current[name];
    } else {
      if (Object.hasOwn(draft, name)) { restoreBackups.current[name] = draft[name]; }
      setDraft((current) => { const next = { ...current }; delete next[name]; return next; });
    }
    setReset((current) => { const next = new Set(current); if (next.has(name)) { next.delete(name); } else { next.add(name); } return next; });
    setMessage(undefined);
  }
  if (!isAdmin) { return null; }
  const term = query.trim().toLocaleLowerCase();
  const groups = settingGroups.filter((group) => term || group.section === section).map((group) => ({ ...group,
    names: group.names.filter((name) => !term || `${name} ${t(`settings.field.${name}`)} ${t(`settings.ux.group.${group.key}`)}`.toLocaleLowerCase().includes(term))
  })).filter((group) => group.names.length > 0);
  return <Stack gap="lg">
    <div className={classes.sectionHeader}>
      <Text size="xs" fw={600} c="dimmed" mb={6}>{t("settings.application.title")}</Text>
      <Title order={2}>{t(term ? "settings.ux.searchResults" : `settings.ux.nav.${section}`)}</Title>
      <Text c="dimmed" size="sm" mt={6}>{t(term ? "settings.ux.searchResultsBody" : `settings.ux.description.${section}`)}</Text>
    </div>
    <TextInput aria-label={t("settings.ux.search")} placeholder={t("settings.ux.search")} leftSection={<IconSearch size={17} />} value={query} onChange={(event) => setQuery(event.currentTarget.value)}
      rightSection={query ? <Button variant="subtle" size="compact-xs" aria-label={t("settings.ux.clearSearch")} onClick={() => setQuery("")}>×</Button> : null} />
    {error ? <Alert ref={feedback} tabIndex={-1} color="red" role="alert">{error}{!view ? <Button ml="md" variant="light" onClick={() => setAttempt((value) => value + 1)}>{t("settings.ux.retry")}</Button> : null}</Alert> : null}
    {message ? <Alert ref={feedback} tabIndex={-1} color="teal" icon={<IconCheck size={18} />} role="status">{message}</Alert> : null}
    {restartNotice ? <Alert color="blue" title={t("settings.ux.restartTitle")}>{t("settings.ux.restartBody")}</Alert> : null}
    {!view && !error ? <Stack aria-label={t("settings.ux.loading")}><Skeleton height={200} radius="lg" /><Skeleton height={150} radius="lg" /></Stack> : null}
    {view && groups.length === 0 ? <div className={classes.empty}><Text fw={600}>{t("settings.ux.noResults")}</Text><Text c="dimmed" size="sm">{t("settings.ux.searchHint")}</Text></div> : null}
    {view ? groups.map((group) => <section className={classes.card} key={group.key} aria-label={t(`settings.ux.group.${group.key}`)}>
      <div className={classes.cardHeading}><Title order={3} size="h4">{t(`settings.ux.group.${group.key}`)}</Title><Text c="dimmed" size="sm" mt={5}>{t(`settings.ux.groupBody.${group.key}`)}</Text></div>
      {group.names.map((name) => {
        const field = view.fields[name], isReset = reset.has(name), changed = Object.hasOwn(draft, name);
        const value = draft[name] ?? (field.secret ? "" : field.value);
        const accessibleLabel = `${t(`settings.field.${name}`)} (${name})`;
        const inputId = `setting-${name}`;
        const descriptionId = `${inputId}-meta`;
        const disabled = pending || isReset;
        const common = { id: inputId, "aria-label": accessibleLabel, "aria-describedby": descriptionId, disabled };
        const number = numericSettings[name], choices = choiceSettings[name];
        return <div className={classes.field} key={name}>
          <div className={classes.fieldLabel}><Text component="label" htmlFor={inputId} fw={600} size="sm">{t(`settings.field.${name}`)}</Text><span className={classes.technicalName}>{name}</span>
            <Group gap={6} mt={10} id={descriptionId}><Badge size="xs" variant="light" color={isReset ? "orange" : changed ? "blue" : "gray"}>{t(isReset ? "settings.ux.restoring" : changed ? "settings.ux.modified" : `settings.ux.source.${field.source}`)}</Badge>
              {field.restartRequired ? <Text size="xs" c="dimmed">{t("settings.application.restartRequired")}</Text> : null}</Group>
          </div>
          <div className={classes.fieldControl}>
            {field.secret ? <PasswordInput {...common} autoComplete="new-password" placeholder={t(field.source === "unset" ? "settings.ux.secretNew" : "settings.ux.secretKeep")} value={value} onChange={(event) => edit(name, event.currentTarget.value)} />
              : booleanSettings.has(name) ? <Switch {...common} checked={value === "true"} label={t(value === "true" ? "settings.ux.enabled" : "settings.ux.disabled")} onChange={(event) => edit(name, String(event.currentTarget.checked))} mt={4} />
              : choices ? <Select {...common} data={choices.map((choice) => ({ value: choice, label: name === "KNOWLEDGE_EXTRACTION_LANGUAGE" ? t(choice === "ko" ? "settings.extractionLanguage.ko" : choice === "en" ? "settings.extractionLanguage.en" : "settings.extractionLanguage.source") : choice }))} placeholder={t("settings.ux.automatic")} allowDeselect={false} clearable={!field.value} clearButtonProps={{ "aria-label": t("settings.ux.automatic"), "aria-hidden": false, tabIndex: 0 }} value={value || null} onChange={(next) => { if (next !== null || !field.value) { edit(name, next ?? ""); } }} />
              : number ? <NumberInput {...common} value={value} min={number.min} max={number.max ?? Number.MAX_SAFE_INTEGER} allowDecimal={number.decimal ?? false} step={number.decimal ? 0.01 : 1} suffix={number.suffix} thousandSeparator="," onChange={(next) => edit(name, String(next))} />
              : <TextInput {...common} value={value} onChange={(event) => edit(name, event.currentTarget.value)} autoComplete="off" placeholder={name.endsWith("URL") || name.endsWith("ENDPOINT") ? "https://…" : undefined} />}
            {name === "DOCUMENT_STORAGE_QUOTA_BYTES" && Number(value) > 0 ? <Text size="xs" c="dimmed" mt={5}>{(Number(value) / 1024 ** 3).toFixed(2)} GiB</Text> : null}
            {field.secret && changed && value === "" ? <Text size="xs" c="orange" mt={5}>{t("settings.ux.clearPending")}</Text> : null}
            {isReset ? <Text size="xs" c="dimmed" mt={5}>{t("settings.ux.restoreHint")}</Text> : null}
            <Group justify="flex-end" gap="xs" className={classes.fieldActions}>
              {field.secret && !isReset && field.source !== "unset" ? <Button disabled={pending} size="compact-xs" variant="subtle" color="gray" aria-label={t("settings.ux.clearValue", { name })} onClick={() => { setDraft((current) => ({ ...current, [name]: "" })); setMessage(undefined); }}>{t("settings.ux.clear")}</Button> : null}
              {field.source === "override" ? <Button disabled={pending} size="compact-xs" variant="subtle" aria-label={t("settings.application.useEnv", { name })} onClick={() => restore(name)}>{t(isReset ? "settings.ux.undoRestore" : "settings.ux.restore")}</Button> : null}
            </Group>
          </div>
        </div>;
      })}
    </section>) : null}
    {view ? <div className={classes.saveBar} data-dirty={changedNames.length > 0 || undefined}>
      <div><Text size="sm" fw={600}>{t(changedNames.length ? "settings.ux.unsaved" : "settings.ux.noChanges", { count: changedNames.length })}</Text><Text size="xs" c="dimmed">{changedNames.length ? t("settings.ux.restartCount", { count: restartCount }) : t("settings.ux.sourceHint")}</Text></div>
      <Group gap="xs"><Button variant="default" disabled={pending || !changedNames.length} onClick={discard}>{t("settings.ux.discard")}</Button><Button leftSection={<IconDeviceFloppy size={16} />} loading={pending} disabled={!changedNames.length} onClick={() => void save()}>{t("settings.application.save")}</Button></Group>
    </div> : null}
  </Stack>;
}
