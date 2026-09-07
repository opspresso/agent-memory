import { headers } from "next/headers";
import { Stack } from "@mantine/core";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { OrganizationSettings } from "./organization-settings";
import { ApplicationSettings } from "./application-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  return (
    <Stack gap="lg">
      <ApplicationSettings isAdmin={user.isAdmin} />
      <OrganizationSettings isAdmin={user.isAdmin} />
    </Stack>
  );
}
