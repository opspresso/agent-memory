import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { TeamManagement } from "./team-management";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  return <TeamManagement />;
}
