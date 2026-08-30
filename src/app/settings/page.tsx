import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { OrganizationSettings } from "./organization-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  return <OrganizationSettings isAdmin={user.isAdmin} />;
}
