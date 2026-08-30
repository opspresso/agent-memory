"use client";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
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
  IconBan,
  IconCheck,
  IconDotsVertical,
  IconRefresh,
  IconTrash,
  IconUserPlus,
  IconX
} from "@tabler/icons-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import type {
  OrganizationMemberStatus,
  OrganizationRole
} from "@/domain/identity/organization-access";

import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

interface MemberView {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: OrganizationRole;
  readonly status: OrganizationMemberStatus;
}

interface TeamView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

interface TeamMemberView {
  readonly teamId: string;
  readonly userId: string;
  readonly role: "member" | "manager";
}

export function MemberManagement() {
  const { organizationId } = useOrganization();
  if (!organizationId) {
    return null;
  }
  return <MemberManagementView key={organizationId} />;
}

function MemberManagementView() {
  const t = useT();
  const { organizationId, access } = useOrganization();
  const [members, setMembers] = useState<readonly MemberView[]>([]);
  const [teams, setTeams] = useState<readonly TeamView[]>([]);
  const [teamMembers, setTeamMembers] = useState<readonly TeamMemberView[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<MemberView>();

  const canManage = access?.role === "admin" || access?.role === "owner";
  const isOwner = access?.role === "owner";

  const load = useCallback(async () => {
    if (!organizationId) {
      return;
    }
    try {
      const [membersBody, teamsBody] = await Promise.all([
        fetch(`/api/organizations/${organizationId}/members`).then((response) =>
          responseJson<{ members: readonly MemberView[] }>(
            response,
            t("organization.requestFailed")
          )
        ),
        fetch(`/api/organizations/${organizationId}/teams`).then((response) =>
          responseJson<{ teams: readonly TeamView[] }>(
            response,
            t("organization.requestFailed")
          )
        )
      ]);
      const teamMemberships = await Promise.all(
        teamsBody.teams.map(async (team) => {
          const body = await fetch(
            `/api/organizations/${organizationId}/teams/${team.id}/members`
          ).then((response) =>
            responseJson<{ members: readonly TeamMemberView[] }>(
              response,
              t("organization.requestFailed")
            )
          );
          return body.members.map((member) => ({ ...member, teamId: team.id }));
        })
      );
      setMembers(membersBody.members);
      setTeams(teamsBody.teams);
      setTeamMembers(teamMemberships.flat());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.loadFailed")
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, t]);

  useEffect(() => {
    if (canManage) {
      void Promise.resolve().then(load);
    }
  }, [canManage, load]);

  function refresh() {
    setLoading(true);
    setError(undefined);
    void load();
  }

  async function runMutation(execute: () => Promise<void>, success: string) {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await execute();
      setMessage(success);
      await load();
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
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? t("organization.requestFailed"));
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await runMutation(async () => {
      await requestJson(`/api/organizations/${organizationId}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          role: form.get("role")
        })
      });
      formElement.reset();
    }, t("organization.memberSaved"));
  }

  function changeRole(member: MemberView, role: OrganizationRole) {
    void runMutation(
      () =>
        requestJson(
          `/api/organizations/${organizationId}/members/${member.userId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role })
          }
        ),
      t("organization.memberSaved")
    );
  }

  function changeStatus(member: MemberView, status: OrganizationMemberStatus) {
    void runMutation(
      () =>
        requestJson(
          `/api/organizations/${organizationId}/members/${member.userId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
          }
        ),
      status === "active"
        ? t("members.approved")
        : status === "blocked"
          ? t("members.blocked")
          : t("organization.memberSaved")
    );
  }

  function assignTeam(member: MemberView, teamId: string) {
    void runMutation(
      () =>
        requestJson(
          `/api/organizations/${organizationId}/teams/${teamId}/members`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: member.email, role: "member" })
          }
        ),
      t("organization.teamMemberSaved")
    );
  }

  function removeFromTeam(member: MemberView, teamId: string) {
    void runMutation(
      () =>
        requestJson(
          `/api/organizations/${organizationId}/teams/${teamId}/members/${member.userId}`,
          { method: "DELETE" }
        ),
      t("members.teamRemoved")
    );
  }

  async function confirmRemove() {
    if (!removeTarget) {
      return;
    }
    const target = removeTarget;
    await runMutation(async () => {
      await requestJson(
        `/api/organizations/${organizationId}/members/${target.userId}`,
        { method: "DELETE" }
      );
      setRemoveTarget(undefined);
    }, t("members.removed"));
  }

  if (!access) {
    return null;
  }
  if (!canManage) {
    return (
      <Alert color="gray">{t("members.accessDenied")}</Alert>
    );
  }

  const statusColor = (status: OrganizationMemberStatus) =>
    status === "active" ? "teal" : status === "pending" ? "yellow" : "red";

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Stack gap={4}>
          <Text c="dimmed" size="sm">
            {t("workspace.eyebrow")}
          </Text>
          <Title order={1}>{t("members.title")}</Title>
          <Text c="dimmed">{t("members.lede")}</Text>
        </Stack>
        <Button
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={refresh}
          variant="subtle"
        >
          {t("organization.refresh")}
        </Button>
      </Group>
      {error ? <Alert color="red">{error}</Alert> : null}
      {message ? <Alert color="teal">{message}</Alert> : null}

      <Paper p="lg" radius="lg" withBorder>
        <form onSubmit={addMember}>
          <Group align="flex-end" gap="md" wrap="wrap">
            <TextInput
              label={t("organization.registeredEmail")}
              name="email"
              required
              style={{ flex: 1, minWidth: 220 }}
              type="email"
            />
            <Select
              data={[
                { value: "member", label: "Member" },
                { value: "admin", label: "Admin" },
                ...(isOwner ? [{ value: "owner", label: "Owner" }] : [])
              ]}
              defaultValue="member"
              label={t("organization.role")}
              name="role"
              required
              w={140}
            />
            <Button
              leftSection={<IconUserPlus size={17} />}
              loading={pending}
              type="submit"
            >
              {t("organization.saveMember")}
            </Button>
          </Group>
        </form>
      </Paper>

      <Paper p="lg" radius="lg" withBorder>
        <Table.ScrollContainer minWidth={780}>
          <Table highlightOnHover striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("members.column.member")}</Table.Th>
                <Table.Th>{t("members.column.role")}</Table.Th>
                <Table.Th>{t("members.column.status")}</Table.Th>
                <Table.Th>{t("members.column.teams")}</Table.Th>
                <Table.Th aria-label={t("members.column.actions")} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map((member) => {
                const memberTeams = teamMembers.filter(
                  (teamMember) => teamMember.userId === member.userId
                );
                const availableTeams = teams.filter(
                  (team) =>
                    !memberTeams.some(
                      (teamMember) => teamMember.teamId === team.id
                    )
                );
                const isSelf = member.userId === access.userId;
                const ownerTarget = member.role === "owner" && !isOwner;
                const locked = isSelf || ownerTarget;
                return (
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
                          { value: "admin", label: "Admin" },
                          ...(isOwner || member.role === "owner"
                            ? [{ value: "owner", label: "Owner" }]
                            : [])
                        ]}
                        disabled={locked || pending}
                        onChange={(value) => {
                          if (value && value !== member.role) {
                            changeRole(member, value as OrganizationRole);
                          }
                        }}
                        size="xs"
                        value={member.role}
                        w={110}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Badge color={statusColor(member.status)} variant="light">
                          {t(
                            member.status === "active"
                              ? "members.status.active"
                              : member.status === "pending"
                                ? "members.status.pending"
                                : "members.status.blocked"
                          )}
                        </Badge>
                        {member.status === "pending" && !locked ? (
                          <Tooltip label={t("members.approve")}>
                            <ActionIcon
                              aria-label={t("members.approve")}
                              color="teal"
                              disabled={pending}
                              onClick={() => changeStatus(member, "active")}
                              variant="light"
                            >
                              <IconCheck size={15} />
                            </ActionIcon>
                          </Tooltip>
                        ) : null}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        {memberTeams.map((teamMember) => {
                          const team = teams.find(
                            (candidate) => candidate.id === teamMember.teamId
                          );
                          if (!team) {
                            return null;
                          }
                          return (
                            <Badge
                              key={team.id}
                              rightSection={
                                <ActionIcon
                                  aria-label={t("members.removeFromTeam", {
                                    team: team.name
                                  })}
                                  color="gray"
                                  disabled={pending}
                                  onClick={() =>
                                    removeFromTeam(member, team.id)
                                  }
                                  size={14}
                                  variant="transparent"
                                >
                                  <IconX size={11} />
                                </ActionIcon>
                              }
                              variant="light"
                            >
                              {team.name}
                              {teamMember.role === "manager" ? " ★" : ""}
                            </Badge>
                          );
                        })}
                        {availableTeams.length > 0 &&
                        member.status === "active" ? (
                          <Select
                            aria-label={t("members.assignTeam", {
                              email: member.email
                            })}
                            data={availableTeams.map((team) => ({
                              value: team.id,
                              label: team.name
                            }))}
                            disabled={pending}
                            onChange={(value) => {
                              if (value) {
                                assignTeam(member, value);
                              }
                            }}
                            placeholder={t("members.addTeam")}
                            size="xs"
                            value={null}
                            w={130}
                          />
                        ) : null}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon
                            aria-label={t("members.actionsFor", {
                              email: member.email
                            })}
                            disabled={locked}
                            variant="subtle"
                          >
                            <IconDotsVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {member.status === "blocked" ? (
                            <Menu.Item
                              leftSection={<IconCheck size={15} />}
                              onClick={() => changeStatus(member, "active")}
                            >
                              {t("members.unblock")}
                            </Menu.Item>
                          ) : (
                            <Menu.Item
                              color="orange"
                              leftSection={<IconBan size={15} />}
                              onClick={() => changeStatus(member, "blocked")}
                            >
                              {t("members.block")}
                            </Menu.Item>
                          )}
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={15} />}
                            onClick={() => setRemoveTarget(member)}
                          >
                            {t("members.remove")}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Modal
        centered
        onClose={() => setRemoveTarget(undefined)}
        opened={removeTarget !== undefined}
        title={t("members.removeTitle")}
      >
        <Stack gap="md">
          <Text size="sm">
            {t("members.removeBody", { email: removeTarget?.email ?? "" })}
          </Text>
          <Group justify="flex-end">
            <Button
              onClick={() => setRemoveTarget(undefined)}
              variant="default"
            >
              {t("resource.cancel")}
            </Button>
            <Button
              color="red"
              leftSection={<IconTrash size={16} />}
              loading={pending}
              onClick={() => void confirmRemove()}
            >
              {t("members.remove")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
