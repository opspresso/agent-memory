"use client";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip
} from "@mantine/core";
import {
  IconPencil,
  IconRefresh,
  IconTrash,
  IconUserPlus,
  IconUsersGroup,
  IconX
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";

import type { TeamRole } from "@/domain/identity/organization-access";

import { WorkspaceHeader, WorkspaceSection } from "../workspace-components";

import { useT } from "../_i18n/provider";
import {
  teamMembersResponseSchema,
  teamsResponseSchema
} from "../api-response-schemas";
import { responseJson, responseOk } from "../http-response";
import { useOrganization } from "../organization-context";

interface TeamView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

interface TeamMemberView {
  readonly teamId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: TeamRole;
}

export function TeamManagement() {
  const { organizationSlug } = useOrganization();
  if (!organizationSlug) {
    return null;
  }
  return <TeamManagementView key={organizationSlug} />;
}

function TeamManagementView() {
  const t = useT();
  const { organizationSlug, access } = useOrganization();
  const [teams, setTeams] = useState<readonly TeamView[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>();
  const [teamMembers, setTeamMembers] = useState<readonly TeamMemberView[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [teamMembersError, setTeamMembersError] = useState<string>();
  const [membersRefresh, setMembersRefresh] = useState(0);
  const [renameTarget, setRenameTarget] = useState<TeamView>();
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TeamView>();
  const teamsRequest = useRef<AbortController | undefined>(undefined);

  const canManageOrganization =
    access?.role === "admin" || access?.role === "owner";
  const canManageTeam = (teamId: string) =>
    canManageOrganization ||
    Boolean(
      access?.teams.some(
        (team) => team.teamId === teamId && team.role === "manager"
      )
    );

  const loadTeams = useCallback(async () => {
    if (!organizationSlug) {
      return;
    }
    teamsRequest.current?.abort();
    const controller = new AbortController();
    teamsRequest.current = controller;
    try {
      const body = await fetch(
        `/api/teams`,
        { signal: controller.signal }
      ).then((response) =>
        responseJson(
          response,
          t("organization.requestFailed"),
          teamsResponseSchema
        )
      );
      if (controller.signal.aborted) {
        return;
      }
      setTeams(body.teams);
      setSelectedTeamId((current) =>
        current && body.teams.some((team) => team.id === current)
          ? current
          : body.teams[0]?.id
      );
      setError(undefined);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      setError(
        caught instanceof Error ? caught.message : t("organization.loadFailed")
      );
    } finally {
      if (teamsRequest.current === controller) {
        teamsRequest.current = undefined;
        setLoading(false);
      }
    }
  }, [organizationSlug, t]);

  useEffect(() => {
    void Promise.resolve().then(loadTeams);
    return () => {
      teamsRequest.current?.abort();
      teamsRequest.current = undefined;
    };
  }, [loadTeams]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTeamMembers() {
      if (controller.signal.aborted) {
        return;
      }
      if (!organizationSlug || !selectedTeamId) {
        setTeamMembers([]);
        setTeamMembersError(undefined);
        return;
      }
      setTeamMembersError(undefined);
      try {
        const response = await fetch(
          `/api/teams/${selectedTeamId}/members`,
          { signal: controller.signal }
        );
        const body = await responseJson(
          response,
          t("organization.requestFailed"),
          teamMembersResponseSchema
        );
        if (!controller.signal.aborted) {
          setTeamMembers(body.members);
        }
      } catch (caught) {
        if (controller.signal.aborted) {
          return;
        }
        setTeamMembers([]);
        setTeamMembersError(
          caught instanceof Error ? caught.message : t("organization.loadFailed")
        );
      }
    }
    void Promise.resolve().then(loadTeamMembers);
    return () => controller.abort();
  }, [organizationSlug, selectedTeamId, membersRefresh, t]);

  function refresh() {
    setLoading(true);
    setError(undefined);
    setTeamMembersError(undefined);
    void loadTeams();
    setMembersRefresh((current) => current + 1);
  }

  async function runMutation(execute: () => Promise<void>, success: string) {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await execute();
      setMessage(success);
      await loadTeams();
      setMembersRefresh((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.requestFailed")
      );
    } finally {
      setPending(false);
    }
  }

  async function requestJson(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    await responseOk(response, t("organization.requestFailed"));
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await runMutation(async () => {
      await requestJson(`/api/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          slug: form.get("slug")
        })
      });
      formElement.reset();
    }, t("organization.teamCreated"));
  }

  async function addTeamMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTeamId) {
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await runMutation(async () => {
      await requestJson(
        `/api/teams/${selectedTeamId}/members`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.get("email"),
            role: form.get("role")
          })
        }
      );
      formElement.reset();
    }, t("organization.teamMemberSaved"));
  }

  function changeTeamMemberRole(member: TeamMemberView, role: TeamRole) {
    void runMutation(
      () =>
        requestJson(
          `/api/teams/${member.teamId}/members`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: member.email, role })
          }
        ),
      t("organization.teamMemberSaved")
    );
  }

  function removeTeamMember(member: TeamMemberView) {
    void runMutation(
      () =>
        requestJson(
          `/api/teams/${member.teamId}/members/${member.userId}`,
          { method: "DELETE" }
        ),
      t("members.teamRemoved")
    );
  }

  async function confirmRename() {
    if (!renameTarget) {
      return;
    }
    const target = renameTarget;
    await runMutation(async () => {
      await requestJson(
        `/api/teams/${target.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renameValue })
        }
      );
      setRenameTarget(undefined);
    }, t("teams.renamed"));
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    await runMutation(async () => {
      await requestJson(
        `/api/teams/${target.id}`,
        { method: "DELETE" }
      );
      setDeleteTarget(undefined);
    }, t("teams.deleted"));
  }

  if (!access) {
    return null;
  }

  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  const visibleTeamMembers = teamMembers.filter(
    (member) => member.teamId === selectedTeamId
  );

  return (
    <Stack gap="lg">
      <WorkspaceHeader
        title={t("teams.title")}
        description={t("teams.lede")}
        actions={<Button leftSection={<IconRefresh size={16} />} loading={loading} onClick={refresh} variant="default">{t("organization.refresh")}</Button>}
      />
      {error ? <Alert color="red">{error}</Alert> : null}
      {teamMembersError ? (
        <Alert color="red">{teamMembersError}</Alert>
      ) : null}
      {message ? <Alert color="teal">{message}</Alert> : null}

      {canManageOrganization ? (
        <WorkspaceSection title={t("organization.createTeam")} description={t("manageUi.teamBody")}>
          <form onSubmit={createTeam}>
            <Group align="flex-end" gap="md" wrap="wrap">
              <TextInput
                label={t("organization.teamName")}
                name="name"
                required
                style={{ flex: "1 1 180px", minWidth: 0 }}
              />
              <TextInput
                label={t("organization.teamSlug")}
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                required
                style={{ flex: "1 1 180px", minWidth: 0 }}
              />
              <Button
                leftSection={<IconUsersGroup size={17} />}
                loading={pending}
                type="submit"
                variant="light"
              >
                {t("organization.createTeam")}
              </Button>
            </Group>
          </form>
        </WorkspaceSection>
      ) : null}

      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Group gap="xs" wrap="wrap">
            {teams.map((team) => (
              <Button
                aria-pressed={team.id === selectedTeamId}
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                size="sm"
                type="button"
                variant={team.id === selectedTeamId ? "filled" : "light"}
              >
                {team.name}
              </Button>
            ))}
            {teams.length === 0 ? (
              <Text c="dimmed" size="sm">
                {t("teams.empty")}
              </Text>
            ) : null}
          </Group>

          {selectedTeam ? (
            <Stack gap="md">
              <Group justify="space-between">
                <Group gap="xs">
                  <Title order={3}>{selectedTeam.name}</Title>
                  <Badge variant="outline">{selectedTeam.slug}</Badge>
                </Group>
                <Group gap="xs">
                  {canManageTeam(selectedTeam.id) ? (
                    <Tooltip label={t("teams.rename")}>
                      <ActionIcon
                        aria-label={t("teams.rename")}
                        onClick={() => {
                          setRenameTarget(selectedTeam);
                          setRenameValue(selectedTeam.name);
                        }}
                        variant="light"
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                  {canManageOrganization ? (
                    <Tooltip label={t("teams.delete")}>
                      <ActionIcon
                        aria-label={t("teams.delete")}
                        color="red"
                        onClick={() => setDeleteTarget(selectedTeam)}
                        variant="light"
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                </Group>
              </Group>

              {canManageTeam(selectedTeam.id) ? (
                <form onSubmit={addTeamMember}>
                  <Group align="flex-end" gap="md" wrap="wrap">
                    <TextInput
                      label={t("organization.memberEmail")}
                      name="email"
                      required
                      style={{ flex: "1 1 220px", minWidth: 0 }}
                      type="email"
                    />
                    <Select
                      data={[
                        { value: "member", label: "Member" },
                        { value: "manager", label: "Manager" }
                      ]}
                      defaultValue="member"
                      label={t("organization.teamRole")}
                      name="role"
                      required
                      w={140}
                    />
                    <Button
                      leftSection={<IconUserPlus size={17} />}
                      loading={pending}
                      type="submit"
                    >
                      {t("organization.saveTeamMember")}
                    </Button>
                  </Group>
                </form>
              ) : null}

              <Table.ScrollContainer minWidth={560}>
                <Table highlightOnHover striped verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("members.column.member")}</Table.Th>
                      <Table.Th>{t("organization.teamRole")}</Table.Th>
                      <Table.Th aria-label={t("members.column.actions")} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleTeamMembers.map((member) => (
                      <Table.Tr key={member.userId}>
                        <Table.Td>
                          <Stack gap={0}>
                            <Text fw={600} size="sm">
                              {member.name}
                            </Text>
                            <Text c="dimmed" size="xs">
                              {member.email}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Select
                            allowDeselect={false}
                            aria-label={t("members.roleOf", {
                              email: member.email
                            })}
                            data={[
                              { value: "member", label: "Member" },
                              { value: "manager", label: "Manager" }
                            ]}
                            disabled={
                              !canManageTeam(member.teamId) || pending
                            }
                            onChange={(value) => {
                              if (value && value !== member.role) {
                                changeTeamMemberRole(
                                  member,
                                  value as TeamRole
                                );
                              }
                            }}
                            size="xs"
                            value={member.role}
                            w={120}
                          />
                        </Table.Td>
                        <Table.Td>
                          {canManageTeam(member.teamId) ? (
                            <Tooltip label={t("members.removeFromTeam", { team: selectedTeam.name })}>
                              <ActionIcon
                                aria-label={t("members.removeFromTeam", {
                                  team: selectedTeam.name
                                })}
                                color="red"
                                disabled={pending}
                                onClick={() => removeTeamMember(member)}
                                variant="subtle"
                              >
                                <IconX size={15} />
                              </ActionIcon>
                            </Tooltip>
                          ) : null}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              {visibleTeamMembers.length === 0 ? (
                <Text c="dimmed" size="sm" ta="center">
                  {t("teams.noMembers")}
                </Text>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      <Modal
        centered
        onClose={() => setRenameTarget(undefined)}
        opened={renameTarget !== undefined}
        title={t("teams.renameTitle")} attributes={{ content: { "aria-label": t("teams.renameTitle") } }}
      >
        <Stack gap="md">
          <TextInput
            label={t("organization.teamName")}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            required
            value={renameValue}
          />
          <Group justify="flex-end">
            <Button onClick={() => setRenameTarget(undefined)} variant="default">
              {t("resource.cancel")}
            </Button>
            <Button
              disabled={renameValue.trim().length === 0}
              loading={pending}
              onClick={() => void confirmRename()}
            >
              {t("teams.rename")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        centered
        onClose={() => setDeleteTarget(undefined)}
        opened={deleteTarget !== undefined}
        title={t("teams.deleteTitle")} attributes={{ content: { "aria-label": t("teams.deleteTitle") } }}
      >
        <Stack gap="md">
          <Text size="sm">
            {t("teams.deleteBody", { name: deleteTarget?.name ?? "" })}
          </Text>
          <Group justify="flex-end">
            <Button onClick={() => setDeleteTarget(undefined)} variant="default">
              {t("resource.cancel")}
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={pending}
              onClick={() => void confirmDelete()}
            >
              {t("teams.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
