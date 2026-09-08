"use client";

import { Alert, Button, Group, Modal, Select, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { canAccessScopedResource } from "@/domain/identity/organization-access";
import { memoryKinds } from "@/domain/memory/memory";
import { useT } from "../_i18n/provider";
import { memoryDetailResponseSchema, teamsResponseSchema } from "../api-response-schemas";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

interface MemoryCreateProps {
  readonly onClose: () => void;
  readonly onCreated: (id: string) => void;
}

export function MemoryCreate({ onClose, onCreated }: MemoryCreateProps) {
  const t = useT();
  const { organizationSlug, organizationId, access } = useOrganization();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<string>("fact");
  const [scopeKind, setScopeKind] = useState("user");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teams, setTeams] = useState<readonly { id: string; name: string }[]>([]);
  const [teamError, setTeamError] = useState(false);
  const [teamRequest, setTeamRequest] = useState(0);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/teams`, { signal: controller.signal })
      .then((response) => responseJson(response, t("organization.requestFailed"), teamsResponseSchema))
      .then((body) => { if (!controller.signal.aborted) setTeams(body.teams); })
      .catch(() => { if (!controller.signal.aborted) setTeamError(true); });
    return () => controller.abort();
  }, [organizationSlug, t, teamRequest]);
  useEffect(() => () => request.current?.abort(), []);

  const writableTeams = access ? teams.filter((team) => canAccessScopedResource(access, "write", { kind: "team", organizationId, teamId: team.id })) : [];
  const canWriteOrganization = access && canAccessScopedResource(access, "write", { kind: "organization", organizationId });

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!access || saving || !title.trim() || !content.trim() || (scopeKind === "team" && !teamId)) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/memories`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, title: title.trim(), content: content.trim(), source: { type: "user" },
          scope: scopeKind === "team" ? { kind: "team", teamId } : { kind: scopeKind }
        })
      });
      const memory = await responseJson(response, t("memoryUi.createFailed"), memoryDetailResponseSchema);
      if (!controller.signal.aborted) onCreated(memory.id);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : t("memoryUi.createFailed"));
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <Modal opened onClose={onClose} title={t("memoryUi.create")} attributes={{ content: { "aria-label": t("memoryUi.create") } }} size="lg" closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}>
    <form onSubmit={(event) => void create(event)}>
      <Stack gap="md">
        <Text c="dimmed" size="sm">{t("memoryUi.createHint")}</Text>
        <TextInput autoFocus required label={t("memory.title")} value={title} maxLength={500} onChange={(event) => setTitle(event.currentTarget.value)} disabled={saving} />
        <Textarea required autosize minRows={7} maxRows={16} label={t("memory.content")} value={content} maxLength={100_000} onChange={(event) => setContent(event.currentTarget.value)} disabled={saving} />
        <Select allowDeselect={false} label={t("memoryUi.kind")} data={memoryKinds.map((value) => ({ value, label: t(`memoryUi.kind.${value}`) }))} value={kind} onChange={(value) => value && setKind(value)} disabled={saving} />
        <Select allowDeselect={false} label={t("workspace.scopeLabel")} data={[
          { value: "user", label: t("workspace.scope.user") },
          ...(writableTeams.length ? [{ value: "team", label: t("workspace.scope.team") }] : []),
          ...(canWriteOrganization ? [{ value: "organization", label: t("workspace.scope.organization") }] : [])
        ]} value={scopeKind} onChange={(value) => { if (value) { setScopeKind(value); setTeamId(null); } }} disabled={saving} />
        <Text size="xs" c="dimmed">{t(scopeKind === "organization" ? "memoryUi.sharedHint" : scopeKind === "team" ? "memoryUi.teamHint" : "memoryUi.privateHint")}</Text>
        {scopeKind === "team" ? <Select required label={t("workspace.shareTeam")} placeholder={t("workspace.selectTeam")} data={writableTeams.map((team) => ({ value: team.id, label: team.name }))} value={teamId} onChange={setTeamId} disabled={saving} /> : null}
        {teamError ? <Alert color="orange"><Group justify="space-between"><Text size="sm">{t("memoryUi.teamLoadFailed")}</Text><Button size="xs" variant="light" onClick={() => { setTeamError(false); setTeamRequest((current) => current + 1); }}>{t("memory.reload")}</Button></Group></Alert> : null}
        {error ? <Alert color="red" role="alert">{error}</Alert> : null}
        <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={saving}>{t("memory.cancel")}</Button><Button type="submit" loading={saving} disabled={!access || !title.trim() || !content.trim() || (scopeKind === "team" && !teamId)}>{t("memoryUi.create")}</Button></Group>
      </Stack>
    </form>
  </Modal>;
}
