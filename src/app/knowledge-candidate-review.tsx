"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
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
import { useEffect, useState } from "react";

import { useT } from "./_i18n/provider";
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
  readonly graph: {
    readonly entities: readonly ProposedEntityView[];
    readonly relationships: readonly ProposedRelationshipView[];
  };
  readonly createdAt: string;
}

interface KnowledgeCandidateReviewProps {
  readonly organizationId: string;
}

async function responseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? fallback;
}

async function requestCandidates(organizationId: string, fallback: string) {
  const response = await fetch(
    `/api/organizations/${organizationId}/knowledge/candidates?limit=100`
  );
  if (!response.ok) {
    throw new Error(await responseError(response, fallback));
  }
  const body = (await response.json()) as {
    candidates?: readonly KnowledgeCandidateView[];
  };
  return body.candidates ?? [];
}

export function KnowledgeCandidateReview({
  organizationId
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
  const selected =
    candidates.find((candidate) => candidate.id === selectedId) ??
    candidates[0];

  async function loadCandidates() {
    setLoading(true);
    setError(undefined);
    try {
      const next = await requestCandidates(organizationId, t("candidate.requestFailed"));
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
    requestCandidates(organizationId, t("candidate.requestFailed"))
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
              : t("candidate.loadFailed")
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId, t]);

  async function review(action: "accept" | "reject") {
    if (!selected) {
      return;
    }
    setReviewing(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/knowledge/candidates/${selected.id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(reason.trim() ? { reason: reason.trim() } : {})
          })
        }
      );
      if (!response.ok) {
        throw new Error(await responseError(response, t("candidate.requestFailed")));
      }
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
      <Group justify="space-between">
        <Stack gap={2}>
          <Text c="brand" fw={750} size="xs" tt="uppercase">
            {t("candidate.eyebrow")}
          </Text>
          <Title order={2}>{t("candidate.title")}</Title>
          <Text c="dimmed" size="sm">
            {t("candidate.lede")}
          </Text>
        </Stack>
        <Button
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={() => void loadCandidates()}
          variant="subtle"
        >
          {t("candidate.refresh")}
        </Button>
      </Group>
      {error ? <Alert color="red">{error}</Alert> : null}
      {message ? <Alert color="teal">{message}</Alert> : null}

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
              {candidates.map((candidate) => (
                <button
                  className={classes.queueItem}
                  data-active={candidate.id === selected.id || undefined}
                  key={candidate.id}
                  onClick={() => setSelectedId(candidate.id)}
                  type="button"
                >
                  <span>
                    {candidate.graph.entities[0]?.canonicalName ??
                      t("candidate.noEntity")}
                  </span>
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

          <Paper className={classes.candidate} p="xl" radius="lg" withBorder>
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

              <div className={classes.evidenceRail}>
                <section className={classes.railStep}>
                  <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                    Source
                  </Text>
                  <Text fw={650} size="sm">{t("candidate.documentChunk")}</Text>
                  <Text c="dimmed" ff="monospace" size="xs">
                    {selected.chunkId}
                  </Text>
                </section>
                <section className={classes.railStep}>
                  <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                    Entities
                  </Text>
                  <Stack gap="xs">
                    {selected.graph.entities.map((entity) => (
                      <Paper className={classes.fact} key={entity.key} p="sm">
                        <Group gap="xs">
                          <Badge size="xs" variant="dot">{entity.kind}</Badge>
                          <Text fw={650} size="sm">{entity.canonicalName}</Text>
                        </Group>
                        {entity.summary ? (
                          <Text c="dimmed" mt={4} size="xs">
                            {entity.summary}
                          </Text>
                        ) : null}
                      </Paper>
                    ))}
                  </Stack>
                </section>
                <section className={classes.railStep}>
                  <Text c="dimmed" fw={700} size="xs" tt="uppercase">
                    Relationships
                  </Text>
                  <Stack gap="xs">
                    {selected.graph.relationships.map((relationship, index) => (
                      <Text key={`${relationship.sourceKey}:${relationship.predicate}:${relationship.targetKey}:${index}`} size="sm">
                        <strong>{relationship.sourceKey}</strong>
                        <span className={classes.predicate}>
                          {relationship.predicate}
                        </span>
                        <strong>{relationship.targetKey}</strong>
                      </Text>
                    ))}
                    {selected.graph.relationships.length === 0 ? (
                      <Text c="dimmed" size="sm">{t("candidate.noRelationships")}</Text>
                    ) : null}
                  </Stack>
                </section>
              </div>

              <Textarea
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
