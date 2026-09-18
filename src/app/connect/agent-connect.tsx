"use client";

import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Paper,
  Stack,
  Text,
  Title
} from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { organizationMemoryServerName } from "@/lib/organization-memory-server-name";

import { WorkspaceHeader } from "../workspace-components";

import { useT } from "../_i18n/provider";
import {
  agentTokenStatusResponseSchema,
  generatedAgentTokenResponseSchema,
  revealedAgentTokenResponseSchema
} from "../api-response-schemas";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

interface AgentTokenStatus {
  readonly configured: boolean;
  readonly masked?: string;
  readonly createdAt?: string;
  readonly revealable?: boolean;
}

export function AgentConnect({ origin }: { readonly origin: string }) {
  const t = useT();
  const { access, activeOrganization, organizationSlug } = useOrganization();
  const canManageToken = access?.role === "admin" || access?.role === "owner";
  const mcpEndpoint =
    organizationSlug && origin
      ? `${origin}/api/mcp`
      : t("workspace.selectOrganization");

  return (
    <Stack gap="lg">
      <WorkspaceHeader title={t("workspace.tab.connect")} description={t("manageUi.connectBody")} />
      <McpEndpointPanel key={`endpoint:${organizationSlug}`} mcpEndpoint={mcpEndpoint} origin={origin} organizationSlug={organizationSlug} />
      <AgentTokenPanel
        canManageToken={canManageToken}
        key={`token:${organizationSlug}:${canManageToken}`}
        organizationSlug={organizationSlug}
      />
      {organizationSlug && origin ? (
        <StudioRegistrationTemplate
          key={`template:${organizationSlug}`}
          mcpEndpoint={mcpEndpoint}
          organizationName={activeOrganization?.name ?? organizationSlug}
          organizationSlug={organizationSlug}
        />
      ) : null}
    </Stack>
  );
}

function StudioRegistrationTemplate({
  mcpEndpoint,
  organizationName,
  organizationSlug
}: {
  readonly mcpEndpoint: string;
  readonly organizationName: string;
  readonly organizationSlug: string;
}) {
  const t = useT();
  const fields = [
    {
      label: "Name",
      value: organizationMemoryServerName(organizationName, organizationSlug)
    },
    { label: "URL", value: mcpEndpoint },
    {
      label: "Description",
      value: t("workspace.studioTemplateDescription", {
        organizationSlug: organizationName
      })
    },
    { label: "Headers · Key", value: "Authorization" },
    { label: "Headers · Value", value: "Bearer <amt_token>" },
    {
      label: "Content",
      value: t("workspace.studioTemplateContent", {
        organizationSlug: organizationName
      })
    }
  ];

  return (
    <Paper
      aria-label={t("workspace.studioTemplateTitle")}
      component="section"
      p="lg"
      radius="lg"
      withBorder
    >
      <Stack gap="md">
        <Group gap="xs"><Badge variant="outline">03</Badge><Title order={2}>{t("workspace.studioTemplateTitle")}</Title></Group>
        <Text c="dimmed">{t("workspace.studioTemplateBody")}</Text>
        {fields.map(({ label, value }) => (
          <Stack gap="xs" key={label}>
            <Group justify="space-between">
              <Text fw={500} size="sm">{label}</Text>
              <CopyButton value={value}>
                {({ copied, copy }) => (
                  <Button
                    aria-label={t("workspace.studioTemplateCopyField", { field: label })}
                    color={copied ? "teal" : "brand"}
                    leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    onClick={copy}
                    size="xs"
                    variant="light"
                  >
                    {copied ? t("workspace.copied") : t("workspace.copy")}
                  </Button>
                )}
              </CopyButton>
            </Group>
            {label === "Content" ? (
              <details>
                <summary style={{ cursor: "pointer", color: "var(--mantine-color-dimmed)", fontSize: "var(--mantine-font-size-sm)" }}>{t("manageUi.operatorNotes")}</summary>
                <Code block mt="xs" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</Code>
              </details>
            ) : <Code block style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</Code>}
          </Stack>
        ))}
        <Text c="dimmed" size="sm">{t("workspace.studioTemplateTokenHint")}</Text>
        <Text c="dimmed" size="sm">{t("workspace.studioTemplateNextSteps")}</Text>
      </Stack>
    </Paper>
  );
}

function McpEndpointPanel({ mcpEndpoint, origin, organizationSlug }: {
  readonly mcpEndpoint: string;
  readonly origin: string;
  readonly organizationSlug: string;
}) {
  const t = useT();
  return (
      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Group gap="xs"><Badge variant="outline">01</Badge><Title order={2}>Streamable HTTP MCP</Title></Group>
          <Text c="dimmed">{t("workspace.mcpBody")}</Text>
          <Group align="stretch" gap="xs" wrap="nowrap">
            <Code block style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {mcpEndpoint}
            </Code>
            <CopyButton value={mcpEndpoint}>
              {({ copied, copy }) => (
                <Button
                  aria-label={t("workspace.copyEndpoint")}
                  color={copied ? "teal" : "brand"}
                  disabled={!organizationSlug || !origin}
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
            context_search · recall · remember · forget ·
            document_search · knowledge_search · knowledge_neighborhood
          </Text>
        </Stack>
      </Paper>
  );
}

function AgentTokenPanel({
  canManageToken,
  organizationSlug
}: {
  readonly canManageToken: boolean;
  readonly organizationSlug: string;
}) {
  const t = useT();
  const [tokenStatus, setTokenStatus] = useState<AgentTokenStatus>();
  const [generatedToken, setGeneratedToken] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!organizationSlug || !canManageToken) {
      return;
    }
    const controller = new AbortController();
    fetch(`/api/agent-token`, {
      signal: controller.signal
    })
      .then((response) =>
        responseJson(
          response,
          t("workspace.agentTokenFailed"),
          agentTokenStatusResponseSchema
        )
      )
      .then(setTokenStatus)
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : t("workspace.agentTokenFailed")
          );
        }
      });
    return () => controller.abort();
  }, [canManageToken, organizationSlug, t]);

  async function generateToken() {
    if (!organizationSlug) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setGeneratedToken(undefined);
    try {
      const generated = await fetch(
        `/api/agent-token`,
        { method: "POST" }
      ).then((response) =>
        responseJson(
          response,
          t("workspace.agentTokenFailed"),
          generatedAgentTokenResponseSchema
        )
      );
      setGeneratedToken(generated.token);
      setTokenStatus({
        configured: true,
        masked: generated.masked,
        createdAt: generated.createdAt,
        revealable: true
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("workspace.agentTokenFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function revealToken() {
    if (!organizationSlug) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setGeneratedToken(undefined);
    try {
      const revealed = await fetch(
        `/api/agent-token/reveal`,
        { method: "POST" }
      ).then((response) =>
        responseJson(
          response,
          t("workspace.agentTokenFailed"),
          revealedAgentTokenResponseSchema
        )
      );
      setGeneratedToken(revealed.token);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("workspace.agentTokenFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken() {
    if (
      !organizationSlug ||
      !window.confirm(t("workspace.agentTokenRevokeConfirm"))
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setGeneratedToken(undefined);
    try {
      const response = await fetch(
        `/api/agent-token`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        await responseJson(
          response,
          t("workspace.agentTokenFailed"),
          agentTokenStatusResponseSchema
        );
      }
      setTokenStatus({ configured: false });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("workspace.agentTokenFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Group gap="xs"><Badge variant="outline">02</Badge><Title order={2}>{t("workspace.agentTokenTitle")}</Title></Group>
          <Text c="dimmed">{t("workspace.agentTokenBody")}</Text>
          {error ? <Alert color="red">{error}</Alert> : null}
          {canManageToken ? (
            <>
              {generatedToken ? (
                <Alert color="yellow" title={t("workspace.agentTokenCopyNow")}>
                  <Stack gap="xs">
                    <Text size="sm">Authorization</Text>
                    <Group align="stretch" gap="xs" wrap="nowrap">
                      <Code block style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        {`Bearer ${generatedToken}`}
                      </Code>
                      <CopyButton value={`Bearer ${generatedToken}`}>
                        {({ copied, copy }) => (
                          <Button
                            color={copied ? "teal" : "brand"}
                            leftSection={
                              copied ? (
                                <IconCheck size={16} />
                              ) : (
                                <IconCopy size={16} />
                              )
                            }
                            onClick={copy}
                            variant="light"
                          >
                            {copied
                              ? t("workspace.copied")
                              : t("workspace.copy")}
                          </Button>
                        )}
                      </CopyButton>
                    </Group>
                  </Stack>
                </Alert>
              ) : tokenStatus?.configured ? (
                <Code block>{tokenStatus.masked}</Code>
              ) : null}
              {tokenStatus?.configured && tokenStatus.revealable === false ? (
                <Alert color="yellow">
                  {t("workspace.agentTokenRegenerateToReveal")}
                </Alert>
              ) : null}
              <Group>
                <Button loading={busy} onClick={() => void generateToken()}>
                  {tokenStatus?.configured
                    ? t("workspace.agentTokenRegenerate")
                    : t("workspace.agentTokenGenerate")}
                </Button>
                {tokenStatus?.configured && tokenStatus.revealable ? (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      generatedToken
                        ? setGeneratedToken(undefined)
                        : void revealToken()
                    }
                    variant="light"
                  >
                    {generatedToken
                      ? t("workspace.agentTokenHide")
                      : t("workspace.agentTokenReveal")}
                  </Button>
                ) : null}
                {tokenStatus?.configured ? (
                  <Button
                    color="red"
                    disabled={busy}
                    onClick={() => void revokeToken()}
                    variant="light"
                  >
                    {t("workspace.agentTokenRevoke")}
                  </Button>
                ) : null}
              </Group>
            </>
          ) : (
            <Text c="dimmed" size="sm">
              {t("workspace.agentTokenAdminOnly")}
            </Text>
          )}
        </Stack>
      </Paper>
  );
}
