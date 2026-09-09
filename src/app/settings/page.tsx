import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { SettingsWorkspace } from "./settings-workspace";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  return <SettingsWorkspace isAdmin={user.isAdmin} />;
}
