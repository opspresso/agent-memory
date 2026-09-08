"use client";

import { Alert, Anchor, Badge, Button, Group, Skeleton, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import Link from "next/link";

import { useT } from "./_i18n/provider";
import { documentChunkDetailResponseSchema, memoryDetailResponseSchema } from "./api-response-schemas";
import { responseJson } from "./http-response";
import { useOrganization } from "./organization-context";

interface SourceEvidenceProps {
  readonly memoryId?: string;
  readonly chunkId?: string;
}

interface Evidence {
  readonly title: string;
  readonly content: string;
  readonly href: string;
  readonly kind: "Memory" | "Document";
}

export function SourceEvidence(props: SourceEvidenceProps) {
  const { organizationSlug } = useOrganization();
  return (
    <EvidenceContent
      {...props}
      key={`${organizationSlug}:${props.memoryId ?? ""}:${props.chunkId ?? ""}`}
      organizationSlug={organizationSlug}
    />
  );
}

function EvidenceContent({ memoryId, chunkId, organizationSlug }: SourceEvidenceProps & { readonly organizationSlug: string }) {
  const t = useT();
  const [evidence, setEvidence] = useState<Evidence>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!organizationSlug || Boolean(memoryId) === Boolean(chunkId)) return;
    const controller = new AbortController();
    async function load() {
      try {
        const base = `/api`;
        let next: Evidence;
        if (memoryId) {
          const value = await fetch(`${base}/memories/${memoryId}`, { signal: controller.signal })
            .then((response) => responseJson(response, t("source.unavailable"), memoryDetailResponseSchema));
          next = { title: value.title, content: value.content, kind: "Memory", href: `/memories?memory=${encodeURIComponent(value.id)}` };
        } else {
          const value = await fetch(`${base}/document-chunks/${chunkId}`, { signal: controller.signal })
            .then((response) => responseJson(response, t("source.unavailable"), documentChunkDetailResponseSchema));
          next = {
            title: `${value.document.title} · ${t("source.chunk", { number: value.chunk.ordinal + 1 })}`,
            content: value.chunk.content,
            kind: "Document",
            href: `/documents?document=${encodeURIComponent(value.document.id)}`
          };
        }
        if (!controller.signal.aborted) setEvidence(next);
      } catch {
        if (!controller.signal.aborted) {
          setEvidence(undefined);
          setError(t("source.unavailable"));
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, chunkId, memoryId, organizationSlug, t]);

  if (Boolean(memoryId) === Boolean(chunkId)) return null;
  if (error) return (
    <Alert color="gray" title={t("source.title")}>
      <Stack gap="xs">
        <Text size="sm">{error}</Text>
        <Button size="xs" variant="default" onClick={() => { setError(undefined); setAttempt((value) => value + 1); }}>
          {t("source.retry")}
        </Button>
      </Stack>
    </Alert>
  );
  if (!evidence) return <Skeleton aria-label={t("source.loading")} height={72} />;
  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs">
        <Badge variant="light">{evidence.kind}</Badge>
        <Anchor component={Link} href={evidence.href} size="sm">{t("source.open")}</Anchor>
      </Group>
      <Text fw={600} size="sm" style={{ overflowWrap: "anywhere" }}>{evidence.title}</Text>
      <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 360, overflowY: "auto" }} tabIndex={0}>
        {evidence.content}
      </Text>
    </Stack>
  );
}
