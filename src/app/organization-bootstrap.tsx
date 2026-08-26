"use client";

import { Alert, Button, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconBuildingPlus } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "조직을 만들지 못했습니다.";
}

export function OrganizationBootstrap() {
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
        throw new Error(await responseMessage(response));
      }
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "조직을 만들지 못했습니다."
      );
      setPending(false);
    }
  }

  return (
    <Paper p="xl" radius="lg" withBorder>
      <form onSubmit={createOrganization}>
        <Stack gap="md">
          <Stack gap={2}>
            <Title order={2}>첫 조직 만들기</Title>
            <Text c="dimmed">
              현재 계정이 owner가 되며 이후 멤버와 팀을 관리할 수 있습니다.
            </Text>
          </Stack>
          {error ? <Alert color="red">{error}</Alert> : null}
          <TextInput label="조직 이름" name="name" required />
          <TextInput
            description="소문자, 숫자, 하이픈만 사용할 수 있습니다."
            label="조직 slug"
            name="slug"
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <Button
            leftSection={<IconBuildingPlus size={18} />}
            loading={pending}
            type="submit"
          >
            조직 만들기
          </Button>
        </Stack>
      </form>
    </Paper>
  );
}
