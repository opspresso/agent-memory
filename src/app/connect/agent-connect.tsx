"use client";

import {
  Alert,
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

import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

interface AgentTokenStatus {
  readonly configured: boolean;
  readonly masked?: string;
  readonly createdAt?: string;
  readonly revealable?: boolean;
}

interface GeneratedAgentToken {
  readonly token: string;
  readonly masked: string;
  readonly createdAt: string;
}

interface RevealedAgentToken {
  readonly token: string;
  readonly createdAt: string;
}

export function AgentConnect({ origin }: { readonly origin: string }) {
  const t = useT();
  const { access, organizationSlug } = useOrganization();
  const canManageToken = access?.role === "admin" || access?.role === "owner";
  const mcpEndpoint =
    organizationSlug && origin
      ? `${origin}/api/organizations/${organizationSlug}/mcp`
      : t("workspace.selectOrganization");

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text c="dimmed" size="sm">
          {t("workspace.eyebrow")}
        </Text>
        <Title order={1}>{t("workspace.tab.connect")}</Title>
      </Stack>
      <AgentConnectionPanels
        canManageToken={canManageToken}
        key={`${organizationSlug}:${canManageToken}`}
        mcpEndpoint={mcpEndpoint}
        origin={origin}
        organizationSlug={organizationSlug}
      />
    </Stack>
  );
}

function AgentConnectionPanels({
  canManageToken,
  mcpEndpoint,
  origin,
  organizationSlug
}: {
  readonly canManageToken: boolean;
  readonly mcpEndpoint: string;
  readonly origin: string;
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
    fetch(`/api/organizations/${organizationSlug}/agent-token`, {
      signal: controller.signal
    })
      .then((response) =>
        responseJson<AgentTokenStatus>(response, t("workspace.agentTokenFailed"))
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
    try {
      const generated = await fetch(
        `/api/organizations/${organizationSlug}/agent-token`,
        { method: "POST" }
      ).then((response) =>
        responseJson<GeneratedAgentToken>(
          response,
          t("workspace.agentTokenFailed")
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
    try {
      const revealed = await fetch(
        `/api/organizations/${organizationSlug}/agent-token/reveal`,
        { method: "POST" }
      ).then((response) =>
        responseJson<RevealedAgentToken>(
          response,
          t("workspace.agentTokenFailed")
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
    try {
      const response = await fetch(
        `/api/organizations/${organizationSlug}/agent-token`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        await responseJson(response, t("workspace.agentTokenFailed"));
      }
      setGeneratedToken(undefined);
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
    <>
      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Title order={3}>Streamable HTTP MCP</Title>
          <Text c="dimmed">{t("workspace.mcpBody")}</Text>
          <Group align="stretch" gap="xs" wrap="nowrap">
            <Code block style={{ flex: 1, overflowWrap: "anywhere" }}>
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
            context_search · memory_search · memory_create · document_search ·
            knowledge_search · knowledge_neighborhood
          </Text>
        </Stack>
      </Paper>
      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Title order={3}>{t("workspace.agentTokenTitle")}</Title>
          <Text c="dimmed">{t("workspace.agentTokenBody")}</Text>
          {error ? <Alert color="red">{error}</Alert> : null}
          {canManageToken ? (
            <>
              {generatedToken ? (
                <Alert color="yellow" title={t("workspace.agentTokenCopyNow")}>
                  <Stack gap="xs">
                    <Text size="sm">Authorization</Text>
                    <Group align="stretch" gap="xs" wrap="nowrap">
                      <Code block style={{ flex: 1, overflowWrap: "anywhere" }}>
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
    </>
  );
}
