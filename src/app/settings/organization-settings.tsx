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
  TagsInput,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import {
  IconDeviceFloppy,
  IconSparkles
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { KnowledgeOntologyMode } from "@/domain/knowledge/knowledge-ontology";

import { WorkspaceHeader } from "../workspace-components";

import { useT } from "../_i18n/provider";
import {
  ontologyRecommendationResponseSchema,
  ontologyResponseSchema,
  organizationDetailResponseSchema,
  teamsResponseSchema
} from "../api-response-schemas";
import { responseJson } from "../http-response";
import { useOrganization } from "../organization-context";

interface OrganizationDetail {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
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

export function OrganizationSettings() {
  const { organizationSlug } = useOrganization();
  if (!organizationSlug) {
    return null;
  }
  return <OrganizationSettingsView key={organizationSlug} />;
}

function OrganizationSettingsView() {
  const t = useT();
  const router = useRouter();
  const { organizationSlug, access } = useOrganization();
  const [organization, setOrganization] = useState<OrganizationDetail>();
  const [teams, setTeams] = useState<readonly TeamView[]>([]);
  const [name, setName] = useState("");
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

  const canManage = access?.role === "admin" || access?.role === "owner";
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
        fetch(`/api/organization`).then((response) =>
          responseJson(
            response,
            t("organization.loadFailed"),
            organizationDetailResponseSchema
          )
        ),
        fetch(`/api/teams`).then((response) =>
          responseJson(
            response,
            t("organization.loadFailed"),
            teamsResponseSchema
          )
        ),
        fetch(
          `/api/knowledge/ontology/recommendations`
        ).then((response) =>
          responseJson(
            response,
            t("organization.loadFailed"),
            ontologyRecommendationResponseSchema
          )
        )
      ]);
      setOrganization(detail);
      setTeams(teamsBody.teams);
      setRecommendation(recommendationBody);
      if (!formInitialized.current) {
        formInitialized.current = true;
        setName(detail.name);
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
      const response = await fetch(`/api/organization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          defaultTeamId,
          ontologyMode,
          ontology: { nodeKinds, edgePredicates }
        })
      });
      const detail = await responseJson(
        response,
        t("organization.requestFailed"),
        organizationDetailResponseSchema
      );
      setOrganization(detail);
      setName(detail.name);
      setDefaultTeamId(detail.defaultTeamId ?? null);
      setOntologyMode(detail.ontologyMode ?? "off");
      setNodeKinds([...(detail.ontology?.nodeKinds ?? [])]);
      setEdgePredicates([...(detail.ontology?.edgePredicates ?? [])]);
      setMessage(t("settings.saved"));
      router.refresh();
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
        `/api/knowledge/ontology/suggestions`,
        { method: "POST" }
      );
      const body = await responseJson(
        response,
        t("organization.requestFailed"),
        ontologyResponseSchema
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

  if (!access) {
    return null;
  }
  if (!canManage) {
    return <Alert color="gray">{t("members.accessDenied")}</Alert>;
  }

  return (
    <Stack gap="lg">
      <WorkspaceHeader title={t("settings.title")} description={t("settings.lede")} />
      {error ? <Alert color="red">{error}</Alert> : null}
      {message ? <Alert color="teal">{message}</Alert> : null}

      {organization ? (
      <Paper p="lg" radius="lg" withBorder>
        <Stack gap="md">
          <Group gap="xs">
            <Title order={3}>{t("settings.general")}</Title>
            <Badge variant="outline">{organization.slug}</Badge>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <TextInput
            label={t("organization.name")}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            value={name}
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
          </SimpleGrid>
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
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
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
            </SimpleGrid>
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

    </Stack>
  );
}
