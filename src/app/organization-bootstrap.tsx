"use client";

import { Alert, Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconBuildingPlus } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

import { useT } from "./_i18n/provider";
import { responseOk } from "./http-response";

export function OrganizationBootstrap({
  redirectTo
}: {
  readonly redirectTo?: string;
}) {
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
      await responseOk(response, t("organization.createFailed"));
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
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
    <Paper p={{ base: "md", sm: "lg" }} radius="lg" withBorder>
      <form onSubmit={createOrganization}>
        <Stack gap="md">
          <Stack gap={2}>
            <Title order={2}>{t("organization.firstTitle")}</Title>
            <Text c="dimmed" size="sm">
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
