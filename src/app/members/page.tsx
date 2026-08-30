import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/session";

import { MemberManagement } from "./member-management";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  return <MemberManagement />;
}
