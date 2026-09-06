"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Skeleton,
  Stack,
  Text,
  Textarea,
  Title
} from "@mantine/core";
import {
  IconCheck,
  IconRefresh,
  IconSparkles,
  IconX
} from "@tabler/icons-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useT } from "./_i18n/provider";
import {
  candidateDuplicatesResponseSchema,
  knowledgeCandidatesResponseSchema
} from "./api-response-schemas";
import { SourceEvidence } from "./source-evidence";
import { WorkspaceHeader } from "./workspace-components";
import { responseJson, responseOk } from "./http-response";
import classes from "./knowledge-candidate-review.module.css";

interface ProposedEntityView {
  readonly key: string;
  readonly kind: string;
  readonly canonicalName: string;
  readonly summary?: string;
}

interface ProposedRelationshipView {
  readonly sourceKey: string;
  readonly targetKey: string;
  readonly predicate: string;
}

interface KnowledgeCandidateView {
  readonly id: string;
  readonly documentId: string;
  readonly chunkId: string;
  readonly model: string;
  readonly scope: Readonly<{
    kind: "organization" | "team" | "user";
    organizationId: string;
    teamId?: string;
    userId?: string;
  }>;
  readonly graph: {
    readonly entities: readonly ProposedEntityView[];
    readonly relationships: readonly ProposedRelationshipView[];
  };
  readonly createdAt: string;
}

interface SimilarNodeView {
  readonly id: string;
  readonly kind: string;
  readonly canonicalName: string;
  readonly scope: KnowledgeCandidateView["scope"];
}

interface OntologyFlagsView {
  readonly mode: "off" | "warn" | "strict";
  readonly violations: readonly Readonly<{
    type: "unknown_kind" | "unknown_predicate";
    term: string;
  }>[];
}

interface KnowledgeCandidateReviewProps {
  readonly organizationSlug: string;
}

async function requestCandidates(organizationSlug: string, fallback: string) {
  const response = await fetch(
    `/api/organizations/${organizationSlug}/knowledge/candidates?limit=100`
  );
  const body = await responseJson(
    response,
    fallback,
    knowledgeCandidatesResponseSchema
  );
  return body.candidates;
}

export function KnowledgeCandidateReview({
  organizationSlug
}: KnowledgeCandidateReviewProps) {
  const t = useT();
  const [candidates, setCandidates] = useState<
    readonly KnowledgeCandidateView[]
  >([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [reason, setReason] = useState("");
  const [duplicateState, setDuplicateState] = useState<
    Readonly<{
      candidateId: string;
      nodes: Readonly<Record<string, readonly SimilarNodeView[]>>;
      ontology?: OntologyFlagsView;
    }>
  >();
  const getLoadMessages = useEffectEvent(() => ({
    requestFailed: t("candidate.requestFailed"),
    loadFailed: t("candidate.loadFailed")
  }));
  const selected =
    candidates.find((candidate) => candidate.id === selectedId) ??
    candidates[0];
  const similarNodes =
    selected && duplicateState?.candidateId === selected.id
      ? duplicateState.nodes
      : {};
  const ontologyFlags =
    selected && duplicateState?.candidateId === selected.id
      ? duplicateState.ontology
      : undefined;
  const ontologyViolations =
    ontologyFlags && ontologyFlags.mode !== "off"
      ? ontologyFlags.violations
      : [];
  const unknownKinds = ontologyViolations
    .filter((violation) => violation.type === "unknown_kind")
    .map((violation) => violation.term);
  const unknownPredicates = ontologyViolations
    .filter((violation) => violation.type === "unknown_predicate")
    .map((violation) => violation.term);
  const strictBlocked =
    ontologyFlags?.mode === "strict" && ontologyViolations.length > 0;
  const unknownTerms = ontologyViolations
    .map((violation) => violation.term)
    .join(", ");

  async function loadCandidates() {
    setLoading(true);
    setError(undefined);
    try {
      const next = await requestCandidates(
        organizationSlug,
        t("candidate.requestFailed")
      );
      setCandidates(next);
      setSelectedId((current) =>
        next.some((candidate) => candidate.id === current)
          ? current
          : next[0]?.id
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("candidate.loadFailed")
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const loadMessages = getLoadMessages();
    requestCandidates(organizationSlug, loadMessages.requestFailed)
      .then((next) => {
        if (active) {
          setCandidates(next);
          setSelectedId(next[0]?.id);
          setLoading(false);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : loadMessages.loadFailed
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [organizationSlug]);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const controller = new AbortController();
    const loadMessages = getLoadMessages();
    fetch(
      `/api/organizations/${organizationSlug}/knowledge/candidates/${selected.id}/duplicates`,
      { signal: controller.signal }
    )
      .then((response) =>
        responseJson(
          response,
          loadMessages.requestFailed,
          candidateDuplicatesResponseSchema
        )
      )
      .then((body) =>
        setDuplicateState({
          candidateId: selected.id,
          nodes: body.duplicates ?? {},
          ...(body.ontology ? { ontology: body.ontology } : {})
        })
      )
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setDuplicateState({ candidateId: selected.id, nodes: {} });
          setError(
            caught instanceof Error
              ? caught.message
              : loadMessages.requestFailed
          );
        }
      });
    return () => controller.abort();
  }, [organizationSlug, selected]);

  async function review(action: "accept" | "reject") {
    if (!selected) {
      return;
    }
    setReviewing(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationSlug}/knowledge/candidates/${selected.id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(reason.trim() ? { reason: reason.trim() } : {})
          })
        }
      );
      await responseOk(response, t("candidate.requestFailed"));
      setMessage(
        action === "accept"
          ? t("candidate.accepted")
          : t("candidate.rejected")
      );
      setReason("");
      await loadCandidates();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("candidate.requestFailed")
      );
    } finally {
      setReviewing(false);
    }
  }

  return (
    <Stack gap="lg">
      <WorkspaceHeader
        eyebrow={t("candidate.eyebrow")}
        title={t("candidate.title")}
        description={t("candidate.lede")}
        actions={<Button leftSection={<IconRefresh size={16} />} loading={loading} disabled={reviewing} onClick={() => void loadCandidates()} variant="default">{t("candidate.refresh")}</Button>}
      />
      {error ? <Alert color="red" role="alert">{error}</Alert> : null}
      {message ? <Alert color="teal" role="status">{message}</Alert> : null}

      {loading && candidates.length === 0 ? <Stack aria-busy="true" aria-label={t("evidence.loading")}><Skeleton height={100} /><Skeleton height={240} /></Stack> : null}

      {!loading && !error && candidates.length === 0 ? (
        <Paper className={classes.empty} p="xl" radius="lg" withBorder>
          <IconSparkles size={28} />
          <Title order={3}>{t("candidate.emptyTitle")}</Title>
          <Text c="dimmed" size="sm">
            {t("candidate.emptyBody")}
          </Text>
        </Paper>
      ) : null}

      {candidates.length > 0 && selected ? (
        <div className={classes.reviewGrid}>
          <ScrollArea className={classes.queue} type="auto">
            <Stack gap="xs">
              <Text size="xs" fw={700} c="dimmed">{t("evidence.queue", { count: candidates.length })}</Text>
              {candidates.map((candidate) => (
                <button
                  className={classes.queueItem}
                  data-active={candidate.id === selected.id || undefined}
                  key={candidate.id}
                  aria-pressed={candidate.id === selected.id}
                  disabled={reviewing}
                  onClick={() => { setSelectedId(candidate.id); setReason(""); setError(undefined); }}
                  type="button"
                >
                  <span>
                    {candidate.graph.entities[0]?.canonicalName ??
                      t("candidate.noEntity")}
                  </span>
                  <small>{t(`workspace.scope.${candidate.scope.kind}`)}</small>
                  <small>
                    {t("candidate.counts", {
                      entities: candidate.graph.entities.length,
                      relations: candidate.graph.relationships.length
                    })}
                  </small>
                </button>
              ))}
            </Stack>
          </ScrollArea>

          <Paper className={classes.candidate} p={{ base: "md", sm: "lg" }} radius="lg" withBorder>
            <Stack gap="xl">
              <Group align="flex-start" justify="space-between">
                <Stack gap={4}>
                  <Badge color="violet" variant="light">
                    {t("candidate.proposal")}
                  </Badge>
                  <Title order={3}>
                    {selected.graph.entities[0]?.canonicalName ??
                      t("candidate.noKnowledge")}
                  </Title>
                </Stack>
                <Text c="dimmed" ff="monospace" size="xs">
                  {selected.model}
                </Text>
              </Group>

              <Badge variant="light">{t(`workspace.scope.${selected.scope.kind}`)}</Badge>
              <div className={classes.evidenceRail}>
                <section className={classes.railStep}>
                  <Text fw={700} size="sm">{t("evidence.original")}</Text>
                  <SourceEvidence key={selected.chunkId} chunkId={selected.chunkId} />
                </section>
                <div className={classes.proposal}>
                  <section className={classes.railStep}>
                    <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                      {t("evidence.entities")}
                    </Text>
                    <Stack gap="xs">
                      {selected.graph.entities.map((entity) => (
                        <Paper className={classes.fact} key={entity.key} p="sm">
                          <Group gap="xs">
                            <Badge size="xs" variant="dot">{entity.kind}</Badge>
                            {unknownKinds.includes(entity.kind) ? (
                              <Badge color="orange" size="xs" variant="light">
                                {t("candidate.ontologyUnknown")}
                              </Badge>
                            ) : null}
                            <Text fw={650} size="sm">{entity.canonicalName}</Text>
                          </Group>
                          {entity.summary ? (
                            <Text c="dimmed" mt={4} size="xs">
                              {entity.summary}
                            </Text>
                          ) : null}
                          {(similarNodes[entity.key]?.length ?? 0) > 0 ? (
                            <Alert color="yellow" mt="xs" p="xs">
                              {t("candidate.similarNodes", {
                                count: similarNodes[entity.key]?.length ?? 0,
                                kinds: similarNodes[entity.key]
                                  ?.map((node) => `${node.canonicalName} (${node.kind})`)
                                  .join(", ") ?? ""
                              })}
                            </Alert>
                          ) : null}
                        </Paper>
                      ))}
                    </Stack>
                  </section>
                  <section className={classes.railStep}>
                    <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                      {t("evidence.relationships")}
                    </Text>
                    <Stack gap="xs">
                      {selected.graph.relationships.map((relationship, index) => (
                        <Text
                          component="div"
                          key={`${relationship.sourceKey}:${relationship.predicate}:${relationship.targetKey}:${index}`}
                          size="sm"
                        >
                          <strong>{selected.graph.entities.find((entity) => entity.key === relationship.sourceKey)?.canonicalName ?? relationship.sourceKey}</strong>
                          <span className={classes.predicate}>
                            {relationship.predicate}
                          </span>
                          <strong>{selected.graph.entities.find((entity) => entity.key === relationship.targetKey)?.canonicalName ?? relationship.targetKey}</strong>
                          {unknownPredicates.includes(relationship.predicate) ? (
                            <Badge color="orange" ml="xs" size="xs" variant="light">
                              {t("candidate.ontologyUnknown")}
                            </Badge>
                          ) : null}
                        </Text>
                      ))}
                      {selected.graph.relationships.length === 0 ? (
                        <Text c="dimmed" size="sm">{t("candidate.noRelationships")}</Text>
                      ) : null}
                    </Stack>
                  </section>
                </div>
              </div>

              {ontologyViolations.length > 0 ? (
                <Alert color={strictBlocked ? "red" : "orange"}>
                  {strictBlocked
                    ? t("candidate.ontologyStrict", { terms: unknownTerms })
                    : t("candidate.ontologyWarn", { terms: unknownTerms })}
                </Alert>
              ) : null}
              <Textarea
                disabled={reviewing}
                autosize
                id="knowledge-review-reason"
                label={t("candidate.reason")}
                maxLength={2_000}
                minRows={2}
                onChange={(event) => setReason(event.currentTarget.value)}
                placeholder={t("candidate.reasonPlaceholder")}
                value={reason}
              />
              <Group justify="flex-end">
                <Button
                  color="red"
                  leftSection={<IconX size={16} />}
                  loading={reviewing}
                  onClick={() => void review("reject")}
                  variant="subtle"
                >
                  {t("candidate.reject")}
                </Button>
                <Button
                  color="teal"
                  disabled={strictBlocked}
                  leftSection={<IconCheck size={16} />}
                  loading={reviewing}
                  onClick={() => void review("accept")}
                >
                  {t("candidate.accept")}
                </Button>
              </Group>
            </Stack>
          </Paper>
        </div>
      ) : null}
    </Stack>
  );
}
