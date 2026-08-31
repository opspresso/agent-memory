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
  TagsInput,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconSparkles,
  IconTrash
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { NewMemberStatus } from "@/domain/identity/organization-access";
import type { KnowledgeOntologyMode } from "@/domain/knowledge/knowledge-ontology";

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
  readonly ontologyMode?: KnowledgeOntologyMode;
  readonly ontology?: {
    readonly nodeKinds: readonly string[];
    readonly edgePredicates: readonly string[];
  };
}

const ONTOLOGY_TERM_LIMIT = 200;
const ONTOLOGY_TERM_LENGTH = 100;

function normalizedOntologyTerms(values: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    const term = value.trim().toLowerCase();
    if (term.length > 0 && term.length <= ONTOLOGY_TERM_LENGTH) {
      terms.add(term);
    }
  }
  return [...terms].slice(0, ONTOLOGY_TERM_LIMIT);
}

interface TeamView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

interface OntologyRecommendation {
  readonly nodeKinds: readonly { term: string; count: number }[];
  readonly edgePredicates: readonly { term: string; count: number }[];
}

interface OntologySuggestion {
  readonly nodeKinds: readonly string[];
  readonly edgePredicates: readonly string[];
}

export function OrganizationSettings({
  isAdmin
}: {
  readonly isAdmin: boolean;
}) {
  const { organizationSlug } = useOrganization();
  if (!organizationSlug) {
    return null;
  }
  return <OrganizationSettingsView isAdmin={isAdmin} key={organizationSlug} />;
}

function OrganizationSettingsView({
  isAdmin
}: {
  readonly isAdmin: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { organizationSlug, access, activeOrganization } = useOrganization();
  const [organization, setOrganization] = useState<OrganizationDetail>();
  const [teams, setTeams] = useState<readonly TeamView[]>([]);
  const [name, setName] = useState("");
  const [newMemberStatus, setNewMemberStatus] =
    useState<NewMemberStatus>("pending");
  const [defaultTeamId, setDefaultTeamId] = useState<string | null>(null);
  const [ontologyMode, setOntologyMode] = useState<KnowledgeOntologyMode>("off");
  const [nodeKinds, setNodeKinds] = useState<string[]>([]);
  const [edgePredicates, setEdgePredicates] = useState<string[]>([]);
  const [recommendation, setRecommendation] =
    useState<OntologyRecommendation>();
  const [suggestion, setSuggestion] = useState<OntologySuggestion>();
  const [suggestionPending, setSuggestionPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [deleteOpened, setDeleteOpened] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const canManage = access?.role === "admin" || access?.role === "owner";
  const isOwner = access?.role === "owner";
  const formInitialized = useRef(false);
  const recommendedKinds =
    recommendation?.nodeKinds.filter(
      (entry) => !nodeKinds.includes(entry.term)
    ) ?? [];
  const recommendedPredicates =
    recommendation?.edgePredicates.filter(
      (entry) => !edgePredicates.includes(entry.term)
    ) ?? [];
  const suggestedKinds =
    suggestion?.nodeKinds.filter((term) => !nodeKinds.includes(term)) ?? [];
  const suggestedPredicates =
    suggestion?.edgePredicates.filter(
      (term) => !edgePredicates.includes(term)
    ) ?? [];

  const load = useCallback(async () => {
    if (!organizationSlug) {
      return;
    }
    try {
      const [detail, teamsBody, recommendationBody] = await Promise.all([
        fetch(`/api/organizations/${organizationSlug}`).then((response) =>
          responseJson<OrganizationDetail>(
            response,
            t("organization.loadFailed")
          )
        ),
        fetch(`/api/organizations/${organizationSlug}/teams`).then((response) =>
          responseJson<{ teams: readonly TeamView[] }>(
            response,
            t("organization.loadFailed")
          )
        ),
        fetch(
          `/api/organizations/${organizationSlug}/knowledge/ontology/recommendations`
        ).then((response) =>
          responseJson<OntologyRecommendation>(
            response,
            t("organization.loadFailed")
          )
        )
      ]);
      setOrganization(detail);
      setTeams(teamsBody.teams);
      setRecommendation(recommendationBody);
      if (!formInitialized.current) {
        formInitialized.current = true;
        setName(detail.name);
        setNewMemberStatus(detail.newMemberStatus ?? "pending");
        setDefaultTeamId(detail.defaultTeamId ?? null);
        setOntologyMode(detail.ontologyMode ?? "off");
        setNodeKinds([...(detail.ontology?.nodeKinds ?? [])]);
        setEdgePredicates([...(detail.ontology?.edgePredicates ?? [])]);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.loadFailed")
      );
    }
  }, [organizationSlug, t]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save() {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/organizations/${organizationSlug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          newMemberStatus,
          defaultTeamId,
          ontologyMode,
          ontology: { nodeKinds, edgePredicates }
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

  async function requestSuggestion() {
    setSuggestionPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationSlug}/knowledge/ontology/suggestions`,
        { method: "POST" }
      );
      const body = await responseJson<OntologySuggestion>(
        response,
        t("organization.requestFailed")
      );
      setSuggestion(body);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("organization.requestFailed")
      );
    } finally {
      setSuggestionPending(false);
    }
  }

  async function confirmDelete() {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/organizations/${organizationSlug}`, {
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

      {organization ? (
        <Paper p="lg" radius="lg" withBorder>
          <Stack gap="md">
            <Stack gap={4}>
              <Title order={3}>{t("settings.ontology.title")}</Title>
              <Text c="dimmed" size="sm">
                {t("settings.ontology.body")}
              </Text>
            </Stack>
            <Select
              allowDeselect={false}
              data={[
                { value: "off", label: t("settings.ontology.mode.off") },
                { value: "warn", label: t("settings.ontology.mode.warn") },
                { value: "strict", label: t("settings.ontology.mode.strict") }
              ]}
              description={t("settings.ontology.mode.description")}
              label={t("settings.ontology.mode.label")}
              onChange={(value) => {
                if (value === "off" || value === "warn" || value === "strict") {
                  setOntologyMode(value);
                }
              }}
              value={ontologyMode}
            />
            <TagsInput
              description={`${t("settings.ontology.nodeKinds.description")} · ${t(
                "settings.ontology.termCount",
                { count: String(nodeKinds.length), max: String(ONTOLOGY_TERM_LIMIT) }
              )}`}
              label={t("settings.ontology.nodeKinds.label")}
              onChange={(values) => setNodeKinds(normalizedOntologyTerms(values))}
              placeholder={t("settings.ontology.nodeKinds.placeholder")}
              splitChars={[",", " "]}
              value={nodeKinds}
            />
            <TagsInput
              description={`${t("settings.ontology.edgePredicates.description")} · ${t(
                "settings.ontology.termCount",
                {
                  count: String(edgePredicates.length),
                  max: String(ONTOLOGY_TERM_LIMIT)
                }
              )}`}
              label={t("settings.ontology.edgePredicates.label")}
              onChange={(values) =>
                setEdgePredicates(normalizedOntologyTerms(values))
              }
              placeholder={t("settings.ontology.edgePredicates.placeholder")}
              splitChars={[",", " "]}
              value={edgePredicates}
            />
            {recommendedKinds.length > 0 || recommendedPredicates.length > 0 ? (
              <Stack gap={6}>
                <Text fw={650} size="sm">
                  {t("settings.ontology.recommend.title")}
                </Text>
                <Text c="dimmed" size="xs">
                  {t("settings.ontology.recommend.body")}
                </Text>
                {recommendedKinds.length > 0 ? (
                  <Group gap={6}>
                    {recommendedKinds.map((entry) => (
                      <Button
                        key={`kind-${entry.term}`}
                        onClick={() =>
                          setNodeKinds((current) =>
                            normalizedOntologyTerms([...current, entry.term])
                          )
                        }
                        size="compact-xs"
                        variant="light"
                      >
                        {entry.term} · {entry.count}
                      </Button>
                    ))}
                  </Group>
                ) : null}
                {recommendedPredicates.length > 0 ? (
                  <Group gap={6}>
                    {recommendedPredicates.map((entry) => (
                      <Button
                        color="grape"
                        key={`predicate-${entry.term}`}
                        onClick={() =>
                          setEdgePredicates((current) =>
                            normalizedOntologyTerms([...current, entry.term])
                          )
                        }
                        size="compact-xs"
                        variant="light"
                      >
                        {entry.term} · {entry.count}
                      </Button>
                    ))}
                  </Group>
                ) : null}
              </Stack>
            ) : null}
            <Group gap="xs">
              <Button
                leftSection={<IconSparkles size={16} />}
                loading={suggestionPending}
                onClick={() => void requestSuggestion()}
                variant="default"
              >
                {t("settings.ontology.suggest.button")}
              </Button>
              <Text c="dimmed" size="xs">
                {t("settings.ontology.suggest.body")}
              </Text>
            </Group>
            {suggestion ? (
              suggestedKinds.length > 0 || suggestedPredicates.length > 0 ? (
                <Stack gap={6}>
                  <Text fw={650} size="sm">
                    {t("settings.ontology.suggest.title")}
                  </Text>
                  <Group gap={6}>
                    {suggestedKinds.map((term) => (
                      <Button
                        key={`suggested-kind-${term}`}
                        onClick={() =>
                          setNodeKinds((current) =>
                            normalizedOntologyTerms([...current, term])
                          )
                        }
                        size="compact-xs"
                        variant="light"
                      >
                        {term}
                      </Button>
                    ))}
                    {suggestedPredicates.map((term) => (
                      <Button
                        color="grape"
                        key={`suggested-predicate-${term}`}
                        onClick={() =>
                          setEdgePredicates((current) =>
                            normalizedOntologyTerms([...current, term])
                          )
                        }
                        size="compact-xs"
                        variant="light"
                      >
                        {term}
                      </Button>
                    ))}
                  </Group>
                </Stack>
              ) : (
                <Text c="dimmed" size="xs">
                  {t("settings.ontology.suggest.empty")}
                </Text>
              )
            ) : null}
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
