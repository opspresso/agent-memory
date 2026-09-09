"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
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

import classes from "./settings.module.css";

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

interface OrganizationSettingsProps {
  readonly section: "general" | "ontology";
  readonly onDirtyChange: (count: number) => void;
}

export function OrganizationSettings(props: OrganizationSettingsProps) {
  const { organizationSlug } = useOrganization();
  if (!organizationSlug) {
    return null;
  }
  return <OrganizationSettingsView key={organizationSlug} {...props} />;
}

function OrganizationSettingsView({ section, onDirtyChange }: OrganizationSettingsProps) {
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
  const [recommendationError, setRecommendationError] = useState(false);
  const [recommendation, setRecommendation] =
    useState<OntologyRecommendation>();
  const [suggestion, setSuggestion] = useState<OntologySuggestion>();
  const [suggestionPending, setSuggestionPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error || message) { feedback.current?.focus(); } }, [error, message]);

  const canManage = access?.role === "admin" || access?.role === "owner";
  const formInitialized = useRef(false);
  const changedCount = organization ? [
    name.trim() !== organization.name,
    defaultTeamId !== (organization.defaultTeamId ?? null),
    ontologyMode !== (organization.ontologyMode ?? "off"),
    JSON.stringify(nodeKinds) !== JSON.stringify(organization.ontology?.nodeKinds ?? []),
    JSON.stringify(edgePredicates) !== JSON.stringify(organization.ontology?.edgePredicates ?? [])
  ].filter(Boolean).length : 0;
  useEffect(() => { onDirtyChange(changedCount); }, [changedCount, onDirtyChange]);
  function discard() {
    if (!organization) { return; }
    setName(organization.name); setDefaultTeamId(organization.defaultTeamId ?? null);
    setOntologyMode(organization.ontologyMode ?? "off");
    setNodeKinds([...(organization.ontology?.nodeKinds ?? [])]);
    setEdgePredicates([...(organization.ontology?.edgePredicates ?? [])]);
    setMessage(undefined); setError(undefined);
  }

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

  const loadRecommendations = useCallback(async (signal?: AbortSignal) => {
    if (!organizationSlug || !canManage) { return; }
    try {
      const response = await fetch("/api/knowledge/ontology/recommendations", { signal });
      const body = await responseJson(response, t("organization.loadFailed"), ontologyRecommendationResponseSchema);
      if (!signal?.aborted) { setRecommendation(body); setRecommendationError(false); }
    } catch {
      if (!signal?.aborted) { setRecommendationError(true); }
    }
  }, [organizationSlug, canManage, t]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!organizationSlug || !canManage) {
      return;
    }
    try {
      const [detail, teamsBody] = await Promise.all([
        fetch(`/api/organization`, { signal }).then((response) =>
          responseJson(
            response,
            t("organization.loadFailed"),
            organizationDetailResponseSchema
          )
        ),
        fetch(`/api/teams`, { signal }).then((response) =>
          responseJson(
            response,
            t("organization.loadFailed"),
            teamsResponseSchema
          )
        ),

      ]);
      if (signal?.aborted) { return; }
      setError(undefined);
      setOrganization(detail);
      setTeams(teamsBody.teams);
      if (!formInitialized.current) {
        formInitialized.current = true;
        setName(detail.name);
        setDefaultTeamId(detail.defaultTeamId ?? null);
        setOntologyMode(detail.ontologyMode ?? "off");
        setNodeKinds([...(detail.ontology?.nodeKinds ?? [])]);
        setEdgePredicates([...(detail.ontology?.edgePredicates ?? [])]);
      }
    } catch (caught) {
      if (signal?.aborted) { return; }
      setError(
        caught instanceof Error ? caught.message : t("organization.loadFailed")
      );
    }
  }, [organizationSlug, canManage, t]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    void Promise.resolve().then(() => loadRecommendations(controller.signal));
    return () => controller.abort();
  }, [load, loadRecommendations]);

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
      <div className={classes.sectionHeader}>
        <Text size="xs" c="dimmed" fw={600} mb={6}>{t("settings.title")}</Text>
        <Title order={2}>{t(`settings.ux.nav.${section}`)}</Title>
        <Text c="dimmed" size="sm" mt={6}>{t(`settings.ux.description.${section}`)}</Text>
      </div>
      {error ? <Alert ref={feedback} tabIndex={-1} color="red" role="alert">{error}{!organization ? <Button variant="light" ml="md" onClick={() => void load()}>{t("settings.ux.retry")}</Button> : null}</Alert> : null}
      {message && !changedCount ? <Alert ref={feedback} tabIndex={-1} color="teal" role="status">{message}</Alert> : null}
      {!organization && !error ? <Skeleton height={280} radius="lg" /> : null}
      <fieldset className={classes.fields} disabled={pending}>
      <Stack gap="lg">

      {organization ? (
      <Paper className={classes.card} hidden={section !== "general"}>
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

        </Stack>
      </Paper>
      ) : null}

      {organization ? (
        <Paper className={classes.card} hidden={section !== "ontology"}>
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
            {recommendationError ? <Alert color="gray"><Text component="span" size="sm">{t("settings.ux.recommendationsUnavailable")}</Text> <Button variant="light" size="compact-xs" onClick={() => void loadRecommendations()}>{t("settings.ux.retry")}</Button></Alert> : null}
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
                disabled={pending}
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

      {organization ? <div className={classes.saveBar} data-dirty={changedCount > 0 || undefined}>
        <div><Text size="sm" fw={600}>{t(changedCount ? "settings.ux.unsaved" : "settings.ux.noChanges", { count: changedCount })}</Text><Text size="xs" c="dimmed">{t("settings.ux.organizationSaveHint")}</Text></div>
        <Group gap="xs"><Button variant="default" disabled={!changedCount || pending} onClick={discard}>{t("settings.ux.discard")}</Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={pending} disabled={!changedCount || !name.trim()} onClick={() => void save()}>{t("settings.save")}</Button></Group>
      </div> : null}
      </Stack>
      </fieldset>
    </Stack>
  );
}
