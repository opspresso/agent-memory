"use client";

import {
  Alert,
  Button,
  Divider,
  Paper,
  PasswordInput,
  SegmentedControl,
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

import { useT } from "./_i18n/provider";
import { authenticationRedirectResponseSchema } from "./api-response-schemas";
import { responseJson, responseOk } from "./http-response";

interface LoginPanelProps {
  readonly googleEnabled: boolean;
  readonly oidcEnabled: boolean;
  readonly passwordEnabled: boolean;
  readonly signUpEnabled: boolean;
}

export function LoginPanel({
  googleEnabled,
  oidcEnabled,
  passwordEnabled,
  signUpEnabled
}: LoginPanelProps) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [passwordMode, setPasswordMode] = useState<"sign-in" | "sign-up">(
    "sign-in"
  );

  async function signInWithProvider(provider: "google" | "oidc") {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, callbackURL: "/" })
      });
      const result = await responseJson(
        response,
        response.ok
          ? t("login.providerUrlMissing")
          : t("login.requestFailed"),
        authenticationRedirectResponseSchema
      );
      window.location.assign(result.url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("login.failed")
      );
      setPending(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const signingUp = passwordMode === "sign-up";
      const response = await fetch(
        signingUp ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(signingUp ? { name: form.get("name") } : {}),
            email: form.get("email"),
            password: form.get("password"),
            callbackURL: "/"
          })
        }
      );
      await responseOk(response, t("login.requestFailed"));
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : t("login.failed")
      );
      setPending(false);
    }
  }

  const configured = googleEnabled || oidcEnabled || passwordEnabled;

  return (
    <Paper aria-labelledby="login-title" p="xl" radius="lg" shadow="xl" withBorder>
      <Stack gap="lg">
        <Stack gap={4}>
          <Text c="brand" fw={700} size="sm">
            {t("login.eyebrow")}
          </Text>
          <Title id="login-title" order={2}>
            {t("login.title")}
          </Title>
          <Text c="dimmed" size="sm">
            {t("login.lede")}
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
            {t("login.enterprise")}
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
            {t("login.google")}
          </Button>
        ) : null}

        {passwordEnabled ? (
          <>
            {oidcEnabled || googleEnabled ? <Divider label={t("login.or")} /> : null}
            <form onSubmit={submitPassword}>
              <Stack gap="md">
                {signUpEnabled ? (
                  <SegmentedControl
                    data={[
                      { label: t("login.signIn"), value: "sign-in" },
                      { label: t("login.signUp"), value: "sign-up" }
                    ]}
                    onChange={(value) =>
                      setPasswordMode(value as "sign-in" | "sign-up")
                    }
                    value={passwordMode}
                  />
                ) : null}
                {passwordMode === "sign-up" ? (
                  <TextInput
                    autoComplete="name"
                    label={t("login.name")}
                    name="name"
                    required
                  />
                ) : null}
                <TextInput
                  autoComplete="email"
                  label={t("login.email")}
                  name="email"
                  placeholder="name@company.com"
                  required
                  type="email"
                />
                <PasswordInput
                  autoComplete="current-password"
                  label={t("login.password")}
                  name="password"
                  required
                />
                <Button loading={pending} type="submit" variant="light">
                  {passwordMode === "sign-up"
                    ? t("login.createAccount")
                    : t("login.emailSignIn")}
                </Button>
              </Stack>
            </form>
          </>
        ) : null}

        {!configured ? (
          <Alert color="yellow" icon={<IconAlertCircle size={18} />}>
            {t("login.notConfigured")}
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}
