import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { listOrganizationMemberships } from "@/lib/organization-service";
import { getSessionUser } from "@/lib/session";

import { OrganizationOnboarding } from "./organization-onboarding";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getSessionUser(new Headers(await headers()));
  if (!user) {
    redirect("/");
  }
  const organizations = await listOrganizationMemberships(user);
  if (organizations.some((organization) => organization.status === "active")) {
    redirect("/");
  }
  return <OrganizationOnboarding pending={organizations.some((organization) => organization.status === "pending")} />;
}
