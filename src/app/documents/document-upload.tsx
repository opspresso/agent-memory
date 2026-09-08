"use client";

import {
  Alert,
  Button,
  Paper,
  Select,
  Stack,
  Text,
  TextInput
} from "@mantine/core";
import { IconCloudUpload } from "@tabler/icons-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { canAccessScopedResource } from "@/domain/identity/organization-access";

import { useT } from "../_i18n/provider";
import {
  documentUploadResponseSchema,
  teamsResponseSchema
} from "../api-response-schemas";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

interface TeamSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

interface DocumentUploadProps {
  readonly onUploaded?: (id: string) => void;
  readonly onUploadingChange?: (uploading: boolean) => void;
}

export function DocumentUpload(props: DocumentUploadProps) {
  const { organizationSlug } = useOrganization();
  if (!organizationSlug) {
    return null;
  }
  return <DocumentUploadView key={organizationSlug} {...props} />;
}

function DocumentUploadView({ onUploaded, onUploadingChange }: DocumentUploadProps) {
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);
  const t = useT();
  const { organizationId, organizationSlug, access } = useOrganization();
  const [teams, setTeams] = useState<readonly TeamSummary[]>([]);
  const [teamLoadError, setTeamLoadError] = useState(false);
  const [teamRequestVersion, setTeamRequestVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string>();
  const [documentScopeKind, setDocumentScopeKind] = useState<
    "organization" | "team" | "user"
  >("user");
  const [documentTeamId, setDocumentTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationSlug) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/teams`, {
      signal: controller.signal
    })
      .then((response) =>
        responseJson(
          response,
          t("organization.requestFailed"),
          teamsResponseSchema
        )
      )
      .then((body) => setTeams(body.teams))
      .catch(() => {
        if (!controller.signal.aborted) {
          setTeamLoadError(true);
        }
      });
    return () => controller.abort();
  }, [organizationSlug, t, teamRequestVersion]);

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

  function reloadTeams() {
    setTeamLoadError(false);
    setTeamRequestVersion((current) => current + 1);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !organizationSlug) {
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true);
    onUploadingChange?.(true);
    setUploadMessage(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("scopeKind", documentScopeKind);
    if (documentScopeKind === "team" && documentTeamId) {
      form.set("teamId", documentTeamId);
    }
    try {
      const response = await fetch(
        `/api/documents`,
        { method: "POST", body: form, signal: controller.signal }
      );
      const body = await responseJson(
        response,
        t("workspace.uploadFailed"),
        documentUploadResponseSchema
      );
      if (controller.signal.aborted) return;
      setUploadMessage(
        body.status === "failed"
          ? t("workspace.uploadQueueFailed", { id: body.id })
          : t("workspace.uploadQueued", { id: body.id })
      );
      formElement.reset();
      onUploaded?.(body.id);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setUploadMessage(
        caught instanceof Error ? caught.message : t("workspace.uploadFailed")
      );
    } finally {
      if (!controller.signal.aborted) {
        setUploading(false);
        onUploadingChange?.(false);
      }
    }
  }

  return (
    <Stack gap="lg">
      <Paper p="lg" radius="lg" withBorder>
        <form onSubmit={upload}>
          <Stack gap="md">
            <Text c="dimmed" size="sm">
              {t("workspace.uploadFormats")}
            </Text>
            {teamLoadError ? (
              <Alert color="red" title={t("organization.loadFailed")}>
                <Button
                  onClick={reloadTeams}
                  size="xs"
                  variant="light"
                >
                  {t("organization.refresh")}
                </Button>
              </Alert>
            ) : null}
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
                !organizationSlug || !access ||
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
