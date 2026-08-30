"use client";

import {
  Alert,
  Button,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { IconCloudUpload } from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";

import { canAccessScopedResource } from "@/domain/identity/organization-access";

import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

interface TeamSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export function DocumentUpload() {
  const { organizationId } = useOrganization();
  if (!organizationId) {
    return null;
  }
  return <DocumentUploadView key={organizationId} />;
}

function DocumentUploadView() {
  const t = useT();
  const { organizationId, access } = useOrganization();
  const [teams, setTeams] = useState<readonly TeamSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string>();
  const [documentScopeKind, setDocumentScopeKind] = useState<
    "organization" | "team" | "user"
  >("user");
  const [documentTeamId, setDocumentTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/organizations/${organizationId}/teams`, {
      signal: controller.signal
    })
      .then((response) =>
        responseJson<{ teams: readonly TeamSummary[] }>(
          response,
          t("organization.requestFailed")
        )
      )
      .then((body) => setTeams(body.teams))
      .catch(() => undefined);
    return () => controller.abort();
  }, [organizationId, t]);

  const writableTeams = access
    ? teams.filter((team) =>
        canAccessScopedResource(access, "write", {
          kind: "team",
          organizationId,
          teamId: team.id
        })
      )
    : [];
  const canManageOrganization =
    access?.role === "admin" || access?.role === "owner";

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

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text c="dimmed" size="sm">
          {t("workspace.eyebrow")}
        </Text>
        <Title order={1}>{t("workspace.uploadTitle")}</Title>
      </Stack>
      <Paper p="lg" radius="lg" withBorder>
        <form onSubmit={upload}>
          <Stack gap="md">
            <Text c="dimmed" size="sm">
              {t("workspace.uploadFormats")}
            </Text>
            <Select
              allowDeselect={false}
              data={[
                { label: t("workspace.scope.user"), value: "user" },
                ...(writableTeams.length > 0
                  ? [{ label: t("workspace.scope.team"), value: "team" }]
                  : []),
                ...(canManageOrganization
                  ? [
                      {
                        label: t("workspace.scope.organization"),
                        value: "organization"
                      }
                    ]
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
    </Stack>
  );
}
