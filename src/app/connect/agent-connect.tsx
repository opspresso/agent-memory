"use client";

import {
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

import { useT } from "../_i18n/provider";
import { useOrganization } from "../organization-context";

export function AgentConnect({ origin }: { readonly origin: string }) {
  const t = useT();
  const { organizationId } = useOrganization();
  const mcpEndpoint =
    organizationId && origin
      ? `${origin}/api/organizations/${organizationId}/mcp`
      : t("workspace.selectOrganization");

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text c="dimmed" size="sm">
          {t("workspace.eyebrow")}
        </Text>
        <Title order={1}>{t("workspace.tab.connect")}</Title>
      </Stack>
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
                  disabled={!organizationId || !origin}
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
    </Stack>
  );
}
