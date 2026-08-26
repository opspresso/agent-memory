"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { IconRefresh, IconUserPlus, IconUsersGroup } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

import { useT } from "./_i18n/provider";

interface OrganizationManagementProps {
  readonly initialMembers: readonly OrganizationMemberView[];
  readonly initialTeams: readonly TeamView[];
  readonly organizationId: string;
}

export interface OrganizationMemberView {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: "admin" | "member" | "owner";
}

export interface TeamView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? fallback;
}

async function sendJson(
  url: string,
  method: "POST" | "PUT",
  value: Readonly<Record<string, FormDataEntryValue | null>>,
  fallback: string
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (!response.ok) {
    throw new Error(await responseMessage(response, fallback));
  }
}

export function OrganizationManagement({
  initialMembers,
  initialTeams,
  organizationId
}: OrganizationManagementProps) {
  const t = useT();
  const [members, setMembers] = useState(initialMembers);
  const [teams, setTeams] = useState(initialTeams);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function loadAdministration() {
    setLoading(true);
    setError(undefined);
    try {
      const [membersResponse, teamsResponse] = await Promise.all([
        fetch(`/api/organizations/${organizationId}/members`),
        fetch(`/api/organizations/${organizationId}/teams`)
      ]);
      if (!membersResponse.ok) {
        throw new Error(await responseMessage(membersResponse, t("organization.requestFailed")));
      }
      if (!teamsResponse.ok) {
        throw new Error(await responseMessage(teamsResponse, t("organization.requestFailed")));
      }
      const [memberBody, teamBody] = await Promise.all([
        membersResponse.json() as Promise<{
          members: readonly OrganizationMemberView[];
        }>,
        teamsResponse.json() as Promise<{ teams: readonly TeamView[] }>
      ]);
      setMembers(memberBody.members);
      setTeams(teamBody.teams);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.loadFailed")
      );
    } finally {
      setLoading(false);
    }
  }

  async function runMutation(
    execute: () => Promise<void>,
    successMessage: string,
    form: HTMLFormElement
  ) {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await execute();
      form.reset();
      setMessage(successMessage);
      await loadAdministration();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.requestFailed")
      );
    } finally {
      setPending(false);
    }
  }

  async function addOrganizationMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await runMutation(
      () =>
        sendJson(`/api/organizations/${organizationId}/members`, "PUT", {
          email: form.get("email"),
          role: form.get("role")
        }, t("organization.requestFailed")),
      t("organization.memberSaved"),
      formElement
    );
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await runMutation(
      () =>
        sendJson(`/api/organizations/${organizationId}/teams`, "POST", {
          name: form.get("name"),
          slug: form.get("slug")
        }, t("organization.requestFailed")),
      t("organization.teamCreated"),
      formElement
    );
  }

  async function addTeamMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const teamId = String(form.get("teamId") ?? "");
    await runMutation(
      () =>
        sendJson(
          `/api/organizations/${organizationId}/teams/${teamId}/members`,
          "PUT",
          { email: form.get("email"), role: form.get("role") },
          t("organization.requestFailed")
        ),
      t("organization.teamMemberSaved"),
      formElement
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Stack gap={2}>
          <Title order={2}>{t("organization.manageTitle")}</Title>
          <Text c="dimmed">{t("organization.manageBody")}</Text>
        </Stack>
        <Button
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={loadAdministration}
          variant="subtle"
        >
          {t("organization.refresh")}
        </Button>
      </Group>
      {error ? <Alert color="red">{error}</Alert> : null}
      {message ? <Alert color="teal">{message}</Alert> : null}

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper p="lg" radius="lg" withBorder>
          <form onSubmit={addOrganizationMember}>
            <Stack gap="md">
              <Title order={3}>{t("organization.members")}</Title>
              <TextInput label={t("organization.registeredEmail")} name="email" required type="email" />
              <Select
                data={[
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                  { value: "owner", label: "Owner" }
                ]}
                defaultValue="member"
                label={t("organization.role")}
                name="role"
                required
              />
              <Button
                leftSection={<IconUserPlus size={17} />}
                loading={pending}
                type="submit"
              >
                {t("organization.saveMember")}
              </Button>
              <Stack gap="xs">
                {members.map((member) => (
                  <Group justify="space-between" key={member.userId}>
                    <Stack gap={0}>
                      <Text fw={600} size="sm">{member.name}</Text>
                      <Text c="dimmed" size="xs">{member.email}</Text>
                    </Stack>
                    <Badge variant="light">{member.role}</Badge>
                  </Group>
                ))}
              </Stack>
            </Stack>
          </form>
        </Paper>

        <Paper p="lg" radius="lg" withBorder>
          <Stack gap="xl">
            <form onSubmit={createTeam}>
              <Stack gap="md">
                <Title order={3}>{t("organization.createTeam")}</Title>
                <TextInput label={t("organization.teamName")} name="name" required />
                <TextInput label={t("organization.teamSlug")} name="slug" required />
                <Button
                  leftSection={<IconUsersGroup size={17} />}
                  loading={pending}
                  type="submit"
                  variant="light"
                >
                  {t("organization.createTeam")}
                </Button>
              </Stack>
            </form>

            <form onSubmit={addTeamMember}>
              <Stack gap="md">
                <Title order={3}>{t("organization.teamMembers")}</Title>
                <Select
                  data={teams.map((team) => ({
                    value: team.id,
                    label: `${team.name} · ${team.slug}`
                  }))}
                  disabled={teams.length === 0}
                  label={t("organization.team")}
                  name="teamId"
                  required
                />
                <TextInput label={t("organization.memberEmail")} name="email" required type="email" />
                <Select
                  data={[
                    { value: "member", label: "Member" },
                    { value: "manager", label: "Manager" }
                  ]}
                  defaultValue="member"
                  label={t("organization.teamRole")}
                  name="role"
                  required
                />
                <Button disabled={teams.length === 0} loading={pending} type="submit">
                  {t("organization.saveTeamMember")}
                </Button>
              </Stack>
            </form>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
