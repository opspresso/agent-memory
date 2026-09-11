"use client";

import { Alert, Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { z } from "zod";
import { canAccessScopedResource } from "@/domain/identity/organization-access";
import { useT } from "../_i18n/provider";
import { documentDetailResponseSchema, documentScopeChangeResponseSchema, documentScopeRestrictionResponseSchema, teamsResponseSchema } from "../api-response-schemas";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

type ScopeResult = z.infer<typeof documentScopeChangeResponseSchema>;

export function DocumentScopeResult({ knowledge }: { readonly knowledge: ScopeResult["knowledge"] }) {
  const t = useT();
  return <Alert color={knowledge.skipped.length ? "yellow" : "teal"} title={t("documentUi.scope.result")} role="status">
    <Stack gap="xs">
      <Text size="sm">{t("documentUi.scope.nodes", knowledge.nodes)}</Text>
      <Text size="sm">{t("documentUi.scope.edges", knowledge.edges)}</Text>
      {knowledge.skipped.map((item) => <Text size="sm" key={`${item.resource}:${item.reason}`}>
        {t(`documentUi.scope.${item.resource}`)} · {t(`documentUi.scope.reason.${item.reason}`)} ({item.count})
      </Text>)}
      {knowledge.skipped.length ? <Text size="sm">{t("documentUi.scope.reapply")}</Text> : null}
    </Stack>
  </Alert>;
}

export function DocumentScopeEditor({ document, onClose, onChanged, onBusyChange, onRefresh }: {
  readonly document: z.infer<typeof documentDetailResponseSchema>;
  readonly onClose: () => void;
  readonly onChanged: (result: ScopeResult) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onRefresh: () => void;
}) {
  const t = useT();
  const { access, organizationId } = useOrganization();
  const [scopeKind, setScopeKind] = useState(document.scope.kind);
  const [teamId, setTeamId] = useState<string | null>(document.scope.kind === "team" ? document.scope.teamId : null);
  const [teams, setTeams] = useState<z.infer<typeof teamsResponseSchema>["teams"]>([]);
  const [teamError, setTeamError] = useState(false);
  const [teamRequest, setTeamRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const request = new AbortController();
    fetch("/api/teams", { signal: request.signal })
      .then((response) => responseJson(response, t("organization.requestFailed"), teamsResponseSchema))
      .then((body) => { if (!request.signal.aborted) setTeams(body.teams); })
      .catch(() => { if (!request.signal.aborted) setTeamError(true); });
    return () => request.abort();
  }, [teamRequest, t]);

  const manageableTeams = access ? teams.filter((team) => canAccessScopedResource(access, "manage", { kind: "team", organizationId, teamId: team.id })) : [];
  const scope = scopeKind === "team" ? { kind: scopeKind, organizationId, teamId: teamId ?? "" }
    : scopeKind === "user" ? { kind: scopeKind, organizationId, userId: access?.userId ?? "" }
    : { kind: scopeKind, organizationId };
  const allowed = Boolean(access && canAccessScopedResource(access, "manage", scope) && (scopeKind !== "team" || manageableTeams.some((team) => team.id === teamId)));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!allowed || saving || needsRefresh) return;
    const request = new AbortController();
    controller.current = request;
    setSaving(true);
    onBusyChange(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: "PATCH", signal: request.signal,
        headers: { "Content-Type": "application/json", "If-Match": `"${document.updatedAt}"` },
        body: JSON.stringify({ scope: scopeKind === "team" ? { kind: scopeKind, teamId } : { kind: scopeKind } })
      });
      if (request.signal.aborted) return;
      if (response.status === 409) {
        const body: unknown = await response.json().catch(() => null);
        if (request.signal.aborted) return;
        if (documentScopeRestrictionResponseSchema.safeParse(body).success) {
          setError(t("documentUi.scope.relatedConflict"));
          return;
        }
      }
      if ([403, 404, 409, 412].includes(response.status)) {
        setNeedsRefresh(true);
        setError(t(response.status === 412 ? "documentUi.scope.conflict" : "documentUi.scope.unavailable"));
        return;
      }
      const result = await responseJson(response, t("documentUi.actionFailed"), documentScopeChangeResponseSchema);
      if (result.document.id !== document.id) throw new Error(t("documentUi.actionFailed"));
      if (!request.signal.aborted) onChanged(result);
    } catch (caught) {
      if (!request.signal.aborted) setError(caught instanceof Error ? caught.message : t("documentUi.actionFailed"));
    } finally {
      if (!request.signal.aborted) { setSaving(false); onBusyChange(false); }
    }
  }

  return <Modal opened onClose={() => { if (!saving) onClose(); }} closeOnEscape={!saving} closeOnClickOutside={!saving} withCloseButton={!saving} title={t("documentUi.scope.change")} attributes={{ content: { "aria-label": t("documentUi.scope.change") } }} centered>
    <form onSubmit={(event) => void save(event)}>
      <Stack gap="md">
        <Text fw={600}>{document.title}</Text>
        <Text size="sm">{t("documentUi.scope.description")}</Text>
        <Select label={t("workspace.scopeLabel")} value={scopeKind} disabled={saving || needsRefresh} allowDeselect={false}
          data={[
            { value: "user", label: t("workspace.scope.user") },
            ...(manageableTeams.length || document.scope.kind === "team" ? [{ value: "team", label: t("workspace.scope.team") }] : []),
            ...(access?.role === "admin" || access?.role === "owner" ? [{ value: "organization", label: t("workspace.scope.organization") }] : [])
          ]}
          onChange={(value) => { if (value === "user" || value === "team" || value === "organization") { setScopeKind(value); setTeamId(null); } }} />
        {scopeKind === "team" ? <Select label={t("workspace.shareTeam")} placeholder={t("workspace.selectTeam")} data={manageableTeams.map((team) => ({ value: team.id, label: team.name }))} value={teamId} onChange={setTeamId} disabled={saving || needsRefresh} allowDeselect={false} required /> : null}
        {teamError ? <Alert color="red">{t("organization.loadFailed")}<Button variant="subtle" onClick={() => { setTeamError(false); setTeamRequest((value) => value + 1); }}>{t("documentUi.refresh")}</Button></Alert> : null}
        {error ? <Alert color="red" role="alert"><Stack gap="xs"><Text size="sm">{error}</Text>{needsRefresh ? <Button variant="light" onClick={onRefresh}>{t("documentUi.refresh")}</Button> : null}</Stack></Alert> : null}
        <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={onClose}>{t("documentUi.cancel")}</Button><Button type="submit" loading={saving} disabled={!allowed || needsRefresh}>{t("documentUi.scope.apply")}</Button></Group>
      </Stack>
    </form>
  </Modal>;
}
