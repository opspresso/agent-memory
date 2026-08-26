"use client";

import {
  Alert,
  Button,
  Divider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import {
  IconAlertCircle,
  IconBrandGoogle,
  IconBuilding
} from "@tabler/icons-react";
import { useState, type FormEvent } from "react";

interface LoginPanelProps {
  readonly googleEnabled: boolean;
  readonly oidcEnabled: boolean;
  readonly passwordEnabled: boolean;
}

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    error?: string;
  } | null;
  return body?.message ?? body?.error ?? "로그인 요청에 실패했습니다.";
}

export function LoginPanel({
  googleEnabled,
  oidcEnabled,
  passwordEnabled
}: LoginPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function signInWithProvider(provider: "google" | "oidc") {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, callbackURL: "/" })
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response));
      }
      const result = (await response.json()) as { url?: string };
      if (!result.url) {
        throw new Error("인증 제공자 URL을 받지 못했습니다.");
      }
      window.location.assign(result.url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "로그인에 실패했습니다."
      );
      setPending(false);
    }
  }

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          callbackURL: "/"
        })
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response));
      }
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "로그인에 실패했습니다."
      );
      setPending(false);
    }
  }

  const configured = googleEnabled || oidcEnabled || passwordEnabled;

  return (
    <Paper aria-labelledby="login-title" p="xl" radius="lg" shadow="xl" withBorder>
      <Stack gap="lg">
        <Stack gap={4}>
          <Text c="indigo" fw={700} size="sm">
            SECURE CONSOLE
          </Text>
          <Title id="login-title" order={2}>
            조직 계정으로 시작
          </Title>
          <Text c="dimmed" size="sm">
            허용된 조직, 팀, 개인 범위만 검색됩니다.
          </Text>
        </Stack>

        {error ? (
          <Alert color="red" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        ) : null}

        {oidcEnabled ? (
          <Button
            leftSection={<IconBuilding size={18} />}
            loading={pending}
            onClick={() => signInWithProvider("oidc")}
            size="md"
          >
            Enterprise SSO로 로그인
          </Button>
        ) : null}
        {googleEnabled ? (
          <Button
            leftSection={<IconBrandGoogle size={18} />}
            loading={pending}
            onClick={() => signInWithProvider("google")}
            size="md"
            variant="default"
          >
            Google로 로그인
          </Button>
        ) : null}

        {passwordEnabled ? (
          <>
            {oidcEnabled || googleEnabled ? <Divider label="또는" /> : null}
            <form onSubmit={signInWithPassword}>
              <Stack gap="md">
                <TextInput
                  autoComplete="email"
                  label="이메일"
                  name="email"
                  placeholder="name@company.com"
                  required
                  type="email"
                />
                <PasswordInput
                  autoComplete="current-password"
                  label="비밀번호"
                  name="password"
                  required
                />
                <Button loading={pending} type="submit" variant="light">
                  이메일로 로그인
                </Button>
              </Stack>
            </form>
          </>
        ) : null}

        {!configured ? (
          <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
            인증 제공자가 설정되지 않았습니다. OIDC 또는 Google 환경 변수를
            구성하세요.
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}
