"use client";

import { Alert, Button, Stack } from "@mantine/core";
import { IconClockPause } from "@tabler/icons-react";
import { useRouter } from "next/navigation";

import { WorkspaceHeader } from "../workspace-components";
import { useT } from "../_i18n/provider";

export function OrganizationOnboarding({ pending }: { readonly pending: boolean }) {
  const t = useT();
  const router = useRouter();
  return (
    <Stack gap="lg" maw={640} mx="auto">
      <WorkspaceHeader
        title={t(pending ? "onboarding.title" : "onboarding.deniedTitle")}
        description={t(pending ? "onboarding.lede" : "onboarding.deniedBody")}
      />
      <Alert color={pending ? "yellow" : "red"} icon={<IconClockPause size={18} />}>
        {t(pending ? "onboarding.pendingNotice" : "members.accessDenied")}
      </Alert>
      <Button variant="light" onClick={() => router.refresh()}>{t("organization.refresh")}</Button>
    </Stack>
  );
}
