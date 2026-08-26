"use client";

import { Alert, Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconBuildingPlus } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

import { useT } from "./_i18n/provider";

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? fallback;
}

export function OrganizationBootstrap() {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          slug: form.get("slug")
        })
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, t("organization.createFailed")));
      }
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("organization.createFailed")
      );
      setPending(false);
    }
  }

  return (
    <Paper p="xl" radius="lg" withBorder>
      <form onSubmit={createOrganization}>
        <Stack gap="md">
          <Stack gap={2}>
            <Title order={2}>{t("organization.firstTitle")}</Title>
            <Text c="dimmed">
              {t("organization.firstBody")}
            </Text>
          </Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label={t("organization.name")} name="name" required />
          <TextInput
            description={t("organization.slugDescription")}
            label={t("organization.slug")}
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <Button
            leftSection={<IconBuildingPlus size={18} />}
            loading={pending}
            type="submit"
          >
            {t("organization.create")}
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
