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

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "요청을 처리하지 못했습니다.";
}

async function sendJson(
  url: string,
  method: "POST" | "PUT",
  value: Readonly<Record<string, FormDataEntryValue | null>>
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value)
  });
  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }
}

export function OrganizationManagement({
  initialMembers,
  initialTeams,
  organizationId
}: OrganizationManagementProps) {
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
        throw new Error(await responseMessage(membersResponse));
      }
      if (!teamsResponse.ok) {
        throw new Error(await responseMessage(teamsResponse));
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
        caught instanceof Error ? caught.message : "관리 정보를 불러오지 못했습니다."
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
        caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다."
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
        }),
      "조직 멤버를 저장했습니다.",
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
        }),
      "팀을 만들었습니다.",
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
          { email: form.get("email"), role: form.get("role") }
        ),
      "팀 멤버를 저장했습니다.",
      formElement
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Stack gap={2}>
          <Title order={2}>조직 관리</Title>
          <Text c="dimmed">가입된 계정을 조직과 팀에 배정합니다.</Text>
        </Stack>
        <Button
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={loadAdministration}
          variant="subtle"
        >
          새로고침
        </Button>
      </Group>
      {error ? <Alert color="red">{error}</Alert> : null}
      {message ? <Alert color="teal">{message}</Alert> : null}

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper p="lg" radius="lg" withBorder>
          <form onSubmit={addOrganizationMember}>
            <Stack gap="md">
              <Title order={3}>조직 멤버</Title>
              <TextInput label="가입된 사용자 이메일" name="email" required type="email" />
              <Select
                data={[
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                  { value: "owner", label: "Owner" }
                ]}
                defaultValue="member"
                label="조직 역할"
                name="role"
                required
              />
              <Button
                leftSection={<IconUserPlus size={17} />}
                loading={pending}
                type="submit"
              >
                멤버 저장
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
                <Title order={3}>팀 만들기</Title>
                <TextInput label="팀 이름" name="name" required />
                <TextInput label="팀 slug" name="slug" required />
                <Button
                  leftSection={<IconUsersGroup size={17} />}
                  loading={pending}
                  type="submit"
                  variant="light"
                >
                  팀 만들기
                </Button>
              </Stack>
            </form>

            <form onSubmit={addTeamMember}>
              <Stack gap="md">
                <Title order={3}>팀 멤버</Title>
                <Select
                  data={teams.map((team) => ({
                    value: team.id,
                    label: `${team.name} · ${team.slug}`
                  }))}
                  disabled={teams.length === 0}
                  label="팀"
                  name="teamId"
                  required
                />
                <TextInput label="조직 멤버 이메일" name="email" required type="email" />
                <Select
                  data={[
                    { value: "member", label: "Member" },
                    { value: "manager", label: "Manager" }
                  ]}
                  defaultValue="member"
                  label="팀 역할"
                  name="role"
                  required
                />
                <Button disabled={teams.length === 0} loading={pending} type="submit">
                  팀 멤버 저장
                </Button>
              </Stack>
            </form>
          </Stack>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
