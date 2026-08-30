"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { IconAlertTriangle, IconDeviceFloppy, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { NewMemberStatus } from "@/domain/identity/organization-access";

import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";
import { OrganizationBootstrap } from "../organization-bootstrap";
import { useOrganization } from "../organization-context";

interface OrganizationDetail {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly newMemberStatus?: NewMemberStatus;
  readonly defaultTeamId?: string | null;
}

interface TeamView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export function OrganizationSettings({
  isAdmin
}: {
  readonly isAdmin: boolean;
}) {
  const { organizationId } = useOrganization();
  if (!organizationId) {
    return null;
  }
  return <OrganizationSettingsView isAdmin={isAdmin} key={organizationId} />;
}

function OrganizationSettingsView({
  isAdmin
}: {
  readonly isAdmin: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { organizationId, access, activeOrganization } = useOrganization();
  const [organization, setOrganization] = useState<OrganizationDetail>();
  const [teams, setTeams] = useState<readonly TeamView[]>([]);
  const [name, setName] = useState("");
  const [newMemberStatus, setNewMemberStatus] =
    useState<NewMemberStatus>("active");
  const [defaultTeamId, setDefaultTeamId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [deleteOpened, setDeleteOpened] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const canManage = access?.role === "admin" || access?.role === "owner";
  const isOwner = access?.role === "owner";
  const formInitialized = useRef(false);

  const load = useCallback(async () => {
    if (!organizationId) {
      return;
    }
    try {
      const [detail, teamsBody] = await Promise.all([
        fetch(`/api/organizations/${organizationId}`).then((response) =>
          responseJson<OrganizationDetail>(
            response,
            t("organization.loadFailed")
          )
        ),
        fetch(`/api/organizations/${organizationId}/teams`).then((response) =>
          responseJson<{ teams: readonly TeamView[] }>(
            response,
            t("organization.loadFailed")
          )
        )
      ]);
      setOrganization(detail);
      setTeams(teamsBody.teams);
      if (!formInitialized.current) {
        formInitialized.current = true;
        setName(detail.name);
        setNewMemberStatus(detail.newMemberStatus ?? "active");
        setDefaultTeamId(detail.defaultTeamId ?? null);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.loadFailed")
      );
    }
  }, [organizationId, t]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save() {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/organizations/${organizationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          newMemberStatus,
          defaultTeamId
        })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? t("organization.requestFailed"));
      }
      setMessage(t("settings.saved"));
      router.refresh();
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.requestFailed")
      );
    } finally {
      setPending(false);
    }
  }

  async function confirmDelete() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/organizations/${organizationId}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? t("organization.requestFailed"));
      }
      setDeleteOpened(false);
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.requestFailed")
      );
      setPending(false);
    }
  }

  if (!access) {
    return null;
  }
  if (!canManage) {
    return <Alert color="gray">{t("members.accessDenied")}</Alert>;
  }

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Text c="dimmed" size="sm">
          {t("workspace.eyebrow")}
        </Text>
        <Title order={1}>{t("settings.title")}</Title>
        <Text c="dimmed">{t("settings.lede")}</Text>
      </Stack>
      {error ? <Alert color="red">{error}</Alert> : null}
      {message ? <Alert color="teal">{message}</Alert> : null}

      {organization ? (
      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Group gap="xs">
            <Title order={3}>{t("settings.general")}</Title>
            <Badge variant="outline">{organization.slug}</Badge>
          </Group>
          <TextInput
            label={t("organization.name")}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            value={name}
          />
          <Select
            allowDeselect={false}
            data={[
              { value: "active", label: t("settings.newMember.active") },
              { value: "pending", label: t("settings.newMember.pending") }
            ]}
            description={t("settings.newMember.description")}
            label={t("settings.newMember.label")}
            onChange={(value) => {
              if (value === "active" || value === "pending") {
                setNewMemberStatus(value);
              }
            }}
            value={newMemberStatus}
          />
          <Select
            clearable
            data={teams.map((team) => ({ value: team.id, label: team.name }))}
            description={t("settings.defaultTeam.description")}
            label={t("settings.defaultTeam.label")}
            onChange={setDefaultTeamId}
            placeholder={t("settings.defaultTeam.placeholder")}
            value={defaultTeamId}
          />
          <Group justify="flex-end">
            <Button
              disabled={name.trim().length === 0}
              leftSection={<IconDeviceFloppy size={16} />}
              loading={pending}
              onClick={() => void save()}
            >
              {t("settings.save")}
            </Button>
          </Group>
        </Stack>
      </Paper>
      ) : null}

      {isAdmin ? (
        <Paper p="lg" radius="lg" withBorder>
          <Stack gap="md">
            <Title order={3}>{t("settings.newOrganization")}</Title>
            <OrganizationBootstrap />
          </Stack>
        </Paper>
      ) : null}

      {isOwner ? (
        <Paper
          p="lg"
          radius="lg"
          style={{
            borderColor:
              "color-mix(in oklab, var(--mantine-color-red-6) 40%, transparent)"
          }}
          withBorder
        >
          <Stack gap="md">
            <Group gap="xs">
              <IconAlertTriangle color="var(--mantine-color-red-6)" size={20} />
              <Title order={3}>{t("settings.danger")}</Title>
            </Group>
            <Text c="dimmed" size="sm">
              {t("settings.deleteBody")}
            </Text>
            <Group>
              <Button
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() => {
                  setDeleteConfirmation("");
                  setDeleteOpened(true);
                }}
                variant="light"
              >
                {t("settings.deleteOrganization")}
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : null}

      <Modal
        centered
        onClose={() => {
          if (!pending) {
            setDeleteOpened(false);
          }
        }}
        opened={deleteOpened}
        title={t("settings.deleteTitle")}
      >
        <Stack gap="md">
          <Text size="sm">
            {t("settings.deleteConfirmBody", {
              name: activeOrganization?.name ?? ""
            })}
          </Text>
          <TextInput
            label={t("settings.deleteConfirmLabel", {
              slug: organization?.slug ?? ""
            })}
            onChange={(event) =>
              setDeleteConfirmation(event.currentTarget.value)
            }
            value={deleteConfirmation}
          />
          <Group justify="flex-end">
            <Button
              disabled={pending}
              onClick={() => setDeleteOpened(false)}
              variant="default"
            >
              {t("resource.cancel")}
            </Button>
            <Button
              color="red"
              disabled={deleteConfirmation !== (organization?.slug ?? "")}
              leftSection={<IconTrash size={16} />}
              loading={pending}
              onClick={() => void confirmDelete()}
            >
              {t("settings.deleteOrganization")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
