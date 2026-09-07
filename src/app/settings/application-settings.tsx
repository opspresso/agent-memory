"use client";

import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { IconDeviceFloppy, IconRotateClockwise } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { appSettingDefinitions, type AppSettingName } from "@/domain/settings/app-settings";

import type { MessageKey } from "../_i18n/messages/en";
import { useT } from "../_i18n/provider";
import { responseJson } from "../http-response";

type SettingSource = "override" | "env" | "default" | "unset";

interface FieldView {
  readonly value: string;
  readonly source: SettingSource;
  readonly secret: boolean;
  readonly restartRequired: boolean;
}

interface SettingsView {
  readonly fields: Readonly<Record<AppSettingName, FieldView>>;
  readonly updatedAt?: string;
}

const settingsViewSchema = z.object({
  fields: z.record(
    z.enum(appSettingDefinitions.map((definition) => definition.name)),
    z.object({
      value: z.string(),
      source: z.enum(["override", "env", "default", "unset"]),
      secret: z.boolean(),
      restartRequired: z.boolean()
    })
  ),
  updatedAt: z.string().optional()
});

const sections: ReadonlyArray<{
  readonly key: string;
  readonly label: MessageKey;
  readonly names: readonly AppSettingName[];
}> = [
  {
    key: "auth",
    label: "settings.application.section.auth",
    names: [
      "BETTER_AUTH_URL", "AUTH_PASSWORD", "AUTH_PASSWORD_SIGNUP",
      "ALLOWED_EMAIL_DOMAINS", "ADMIN_EMAILS", "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET", "OIDC_ISSUER", "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET", "OIDC_SCOPES"
    ]
  },
  {
    key: "ai",
    label: "settings.application.section.ai",
    names: [
      "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL",
      "RERANKER_BASE_URL", "RERANKER_API_KEY", "RERANKER_MODEL",
      "RERANKER_TIMEOUT_MS", "RERANKER_MIN_SCORE",
      "KNOWLEDGE_EXTRACTION_BASE_URL", "KNOWLEDGE_EXTRACTION_API_KEY",
      "KNOWLEDGE_EXTRACTION_MODEL", "AI_PROVIDER_MAX_CONCURRENCY",
      "AI_PROVIDER_REQUESTS_PER_MINUTE", "AI_ORGANIZATION_REQUESTS_PER_MINUTE",
      "AI_USER_REQUESTS_PER_MINUTE"
    ]
  },
  {
    key: "document",
    label: "settings.application.section.document",
    names: [
      "DOCUMENT_WORKER_ENABLED", "DOCUMENT_STORAGE_QUOTA_BYTES",
      "DOCUMENT_PENDING_QUOTA", "DOCUMENT_UPLOADS_PER_USER_PER_HOUR"
    ]
  },
  {
    key: "storage",
    label: "settings.application.section.storage",
    names: [
      "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY", "S3_FORCE_PATH_STYLE"
    ]
  },
  {
    key: "observability",
    label: "settings.application.section.observability",
    names: [
      "LOG_LEVEL", "METRICS_BEARER_TOKEN", "LANGFUSE_PUBLIC_KEY",
      "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL", "LANGFUSE_EXPORT_MODE",
      "LANGFUSE_TRACING_ENVIRONMENT"
    ]
  }
];

const sourceColors: Record<SettingSource, string> = {
  override: "blue",
  env: "gray",
  default: "gray",
  unset: "gray"
};

export function ApplicationSettings({ isAdmin }: { readonly isAdmin: boolean }) {
  const t = useT();
  const [view, setView] = useState<SettingsView>();
  const [values, setValues] = useState<Partial<Record<AppSettingName, string>>>({});
  const [dirty, setDirty] = useState<ReadonlySet<AppSettingName>>(new Set());
  const [reset, setReset] = useState<ReadonlySet<AppSettingName>>(new Set());
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const applyView = useCallback((next: SettingsView) => {
    setView(next);
    setValues(
      Object.fromEntries(
        Object.entries(next.fields).map(([name, field]) => [name, field.value])
      )
    );
    setDirty(new Set());
    setReset(new Set());
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    let cancelled = false;
    void fetch("/api/settings/runtime")
      .then((response) =>
        responseJson(
          response,
          t("settings.application.loadFailed"),
          settingsViewSchema
        )
      )
      .then((body) => {
        if (!cancelled) {
          applyView(body);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : t("settings.application.loadFailed")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyView, isAdmin, t]);

  if (!isAdmin) {
    return null;
  }

  async function save() {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch("/api/settings/runtime", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reset: [...reset],
          values: Object.fromEntries(
            [...dirty]
              .filter((name) => !reset.has(name))
              .map((name) => [name, values[name] ?? ""])
          )
        })
      });
      const body = await responseJson(
        response,
        t("settings.application.saveFailed"),
        settingsViewSchema
      );
      applyView(body);
      setMessage(t("settings.application.saved"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("settings.application.saveFailed")
      );
    } finally {
      setPending(false);
    }
  }

  const changed = dirty.size > 0 || reset.size > 0;

  return (
    <Paper p="lg" radius="lg" withBorder>
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={3}>{t("settings.application.title")}</Title>
          <Text c="dimmed" size="sm">
            {t("settings.application.body")}
          </Text>
        </Stack>
        {error ? <Alert color="red">{error}</Alert> : null}
        {message ? <Alert color="teal">{message}</Alert> : null}
        {view ? (
          <Accordion multiple variant="separated">
            {sections.map((section) => (
              <Accordion.Item key={section.key} value={section.key}>
                <Accordion.Control>{t(section.label)}</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="md">
                    {section.names.map((name) => {
                      const field = view.fields[name];
                      const isReset = reset.has(name);
                      return (
                        <TextInput
                          key={name}
                          description={
                            field.restartRequired
                              ? t("settings.application.restartRequired")
                              : undefined
                          }
                          label={
                            <Group component="span" gap="xs">
                              <Text component="span" ff="monospace" size="sm">
                                {name}
                              </Text>
                              <Badge color={sourceColors[field.source]} size="xs">
                                {isReset
                                  ? t("settings.application.resetPending")
                                  : field.source}
                              </Badge>
                            </Group>
                          }
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setValues((current) => ({ ...current, [name]: value }));
                            setDirty((current) => new Set(current).add(name));
                            setReset((current) => {
                              const next = new Set(current);
                              next.delete(name);
                              return next;
                            });
                          }}
                          rightSection={
                            field.source === "override" ? (
                              <Button
                                aria-label={t("settings.application.useEnv", { name })}
                                onClick={() => {
                                  setReset((current) => new Set(current).add(name));
                                  setDirty((current) => {
                                    const next = new Set(current);
                                    next.delete(name);
                                    return next;
                                  });
                                }}
                                p={4}
                                size="compact-xs"
                                variant="subtle"
                              >
                                <IconRotateClockwise size={14} />
                              </Button>
                            ) : undefined
                          }
                          type={field.secret ? "password" : "text"}
                          value={values[name] ?? ""}
                        />
                      );
                    })}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        ) : null}
        <Group justify="flex-end">
          <Button
            disabled={!view || !changed}
            leftSection={<IconDeviceFloppy size={16} />}
            loading={pending}
            onClick={() => void save()}
          >
            {t("settings.application.save")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
