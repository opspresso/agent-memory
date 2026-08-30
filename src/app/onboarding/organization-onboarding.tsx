"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBuildingCommunity,
  IconClockPause,
  IconLogin2
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";
import { OrganizationBootstrap } from "../organization-bootstrap";

interface OrganizationSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export function OrganizationOnboarding({
  isAdmin,
  pendingOrganizations
}: {
  readonly isAdmin: boolean;
  readonly pendingOrganizations: readonly OrganizationSummary[];
}) {
  const t = useT();
  const router = useRouter();
  const [available, setAvailable] = useState<readonly OrganizationSummary[]>();
  const [error, setError] = useState<string>();
  const [joiningId, setJoiningId] = useState<string>();
  const [pendingIds, setPendingIds] = useState<readonly string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/organizations/available", { signal: controller.signal })
      .then((response) =>
        responseJson<{ organizations: readonly OrganizationSummary[] }>(
          response,
          t("onboarding.loadFailed")
        )
      )
      .then((body) => setAvailable(body.organizations))
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : t("onboarding.loadFailed")
          );
          setAvailable([]);
        }
      });
    return () => controller.abort();
  }, [t]);

  async function join(organizationId: string) {
    setJoiningId(organizationId);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/join`,
        { method: "POST" }
      );
      const body = await responseJson<{ status?: string }>(
        response,
        t("onboarding.joinFailed")
      );
      if (body.status === "active") {
        router.refresh();
        return;
      }
      setPendingIds((current) => [...current, organizationId]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("onboarding.joinFailed")
      );
    } finally {
      setJoiningId(undefined);
    }
  }

  const hasPending = pendingOrganizations.length > 0 || pendingIds.length > 0;

  return (
    <Stack gap="lg" maw={640} mx="auto">
      <Stack gap={4}>
        <Text c="dimmed" size="sm">
          {t("onboarding.eyebrow")}
        </Text>
        <Title order={1}>{t("onboarding.title")}</Title>
        <Text c="dimmed">{t("onboarding.lede")}</Text>
      </Stack>

      {error ? (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      ) : null}

      {hasPending ? (
        <Alert color="yellow" icon={<IconClockPause size={18} />}>
          {t("onboarding.pendingNotice")}
        </Alert>
      ) : null}

      {pendingOrganizations.map((organization) => (
        <Paper key={organization.id} p="md" radius="lg" withBorder>
          <Group justify="space-between">
            <Group gap="sm">
              <IconBuildingCommunity size={20} />
              <Stack gap={0}>
                <Text fw={600}>{organization.name}</Text>
                <Text c="dimmed" size="xs">{organization.slug}</Text>
              </Stack>
            </Group>
            <Badge color="yellow" variant="light">
              {t("onboarding.pendingBadge")}
            </Badge>
          </Group>
        </Paper>
      ))}

      {(available ?? []).map((organization) => (
        <Paper key={organization.id} p="md" radius="lg" withBorder>
          <Group justify="space-between">
            <Group gap="sm">
              <IconBuildingCommunity size={20} />
              <Stack gap={0}>
                <Text fw={600}>{organization.name}</Text>
                <Text c="dimmed" size="xs">{organization.slug}</Text>
              </Stack>
            </Group>
            {pendingIds.includes(organization.id) ? (
              <Badge color="yellow" variant="light">
                {t("onboarding.pendingBadge")}
              </Badge>
            ) : (
              <Button
                leftSection={<IconLogin2 size={16} />}
                loading={joiningId === organization.id}
                onClick={() => void join(organization.id)}
                variant="light"
              >
                {t("onboarding.join")}
              </Button>
            )}
          </Group>
        </Paper>
      ))}

      {available !== undefined &&
      available.length === 0 &&
      !hasPending &&
      pendingIds.length === 0 ? (
        <Alert color="gray" icon={<IconAlertCircle size={18} />}>
          {t("onboarding.empty")}
        </Alert>
      ) : null}

      {isAdmin ? <OrganizationBootstrap /> : null}
    </Stack>
  );
}
