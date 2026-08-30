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
  const organizations = await listOrganizationMemberships(user.id);
  if (organizations.some((organization) => organization.status === "active")) {
    redirect("/");
  }
  return (
    <OrganizationOnboarding
      isAdmin={user.isAdmin}
      pendingOrganizations={organizations
        .filter((organization) => organization.status === "pending")
        .map((organization) => ({
          id: organization.id,
          name: organization.name,
          slug: organization.slug
        }))}
    />
  );
}
